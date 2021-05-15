import axios from 'axios';
import * as AWS from 'aws-sdk';
import * as fs from 'fs';
import * as prettyBytes from 'pretty-bytes';
import * as ora from 'ora';

type Credentials = {
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  url: string;
};

type Upload = {
  url: string;
  tileset: string;
  name: string;
};

type UploadProcessing = {
  complete: boolean;
  tileset: string;
  error: string | null;
  id: string;
  name: string;
  modified: string;
  created: string;
  owner: string;
  progress: number;
};

type ProcessStatus = {
  complete: boolean;
  tileset: string;
  error: string | null;
  id: string;
  name: string;
  modified: string;
  created: string;
  owner: string;
  progress: number;
};

const delay = (ms:number) => new Promise(resolve => setTimeout(resolve, ms))

const credentialsUrl = (username: string, token: string) =>
  `https://api.mapbox.com/uploads/v1/${username}/credentials?access_token=${token}`;

const uploadUrl = (username: string, token: string) =>
  `https://api.mapbox.com/uploads/v1/${username}?access_token=${token}`;

const fileUrl = (bucket: string, key: string) =>
  `http://${bucket}.s3.amazonaws.com/${key}`;

const uploadStatusUrl = (username: string, uploadId: string, token: string) =>
  `https://api.mapbox.com/uploads/v1/${username}/${uploadId}?access_token=${token}`;

export const upload = async (
  source: string,
  name: string,
  slug: string,
  username: string,
  token: string,
  awaitProcessing: boolean = false
) => {
  try {
    const readSpinner = ora('Reading file into memory...').start();
    const file = fs.readFileSync(source);
    readSpinner.succeed('Read file.');

    const fetchingSpinner = ora(`Preparing to upload ${source} (${prettyBytes(file.length)}).`).start();
    const credentials = await fetchCredentials(username, token);
    fetchingSpinner.succeed(`Fetched credentials for upload from MapBox (${credentials.key}).`);

    const uploadSpinner = ora(`Uploading file to S3.`).start();
    await uploadToS3(credentials, file);
    uploadSpinner.succeed('Uploaded file to S3.');

    const startSpinner = ora(`Starting processing ${name} (${credentials.key}) at MapBox.`).start();
    const processing = await startUpload(
      username,
      slug,
      name,
      credentials.bucket,
      credentials.key,
      token
    );
    startSpinner.succeed(`Started processing ${name} (${processing.tileset}) at MapBox.`);

    const id = processing.id;

    if (awaitProcessing) {
      let progress: number = 0;
      const processSpinner = ora(`Progress at MapBox: ${Math.round(progress * 100)}%`).start();

      while (progress !== undefined && progress < 1) {
        const processStatus = await getUploadStatus(username, id, token);
        if (processStatus.error) {
          const txt = `Error occurred while processing ${name} (${processing.tileset}): ${processStatus.error}.`;
          processSpinner.fail(txt)
          return -1;
        }
        progress = processStatus.progress;
        processSpinner.text = `Progress at MapBox: ${Math.round(progress * 100)}%`;
        await delay(1000);
      }

      processSpinner.succeed(`Done processing upload ${name} (${processing.tileset}). Check MapBox Studio for the resulting tileset.`);
      return 0;
    } else {
      ora(
        `Not waiting on process to finish. Check MapBox Studio for the progress.`
      ).succeed();
      return 0;
    }
  } catch (ex) {
    console.error(ex.message);
    return -1;
  }
};

const uploadToS3 = async (credentials: Credentials, data: AWS.S3.Body) => {
  const s3 = new AWS.S3({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: 'us-east-1',
    sessionToken: credentials.sessionToken,
  });
  const output = await new Promise<AWS.S3.PutObjectOutput>(resolve =>
    s3.putObject(
      {
        Body: data,
        Bucket: credentials.bucket,
        Key: credentials.key,
      },
      (err, data) => {
        if (err) throw err;
        resolve(data);
      }
    )
  );
};

async function fetchCredentials(username: string, token: string) {
  const url = credentialsUrl(username, token);

  const credentials = await axios.post(url);

  if (credentials.status !== 200)
    throw Error(
      `Could not fetch upload credentials, status: ${credentials.status}: ${credentials.statusText}.`
    );

  return credentials.data as Credentials;
}

async function startUpload(
  username: string,
  slug: string,
  name: string,
  bucket: string,
  key: string,
  token: string
) {
  const upload: Upload = {
    url: fileUrl(bucket, key),
    tileset: `${username}.${slug}`,
    name,
  };

  const credentials = await axios.post(uploadUrl(username, token), upload, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });

  if (credentials.status !== 201)
    throw Error(
      `Could not start upload processing: ${credentials.status}: ${credentials.statusText}.`
    );

  return credentials.data as UploadProcessing;
}

const getUploadStatus = async (
  username: string,
  uploadId: string,
  token: string
) => {
  const uploadStatus = await axios.get(
    uploadStatusUrl(username, uploadId, token),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    }
  );
  if (uploadStatus.status !== 200)
    throw Error(
      `Could processing status: ${uploadStatus.status}: ${uploadStatus.statusText}.`
    );

  return uploadStatus.data as ProcessStatus;
};
