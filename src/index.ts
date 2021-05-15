import {Command} from 'commander';
import {upload} from './commands/upload';
const program = new Command("mapbox-utils");

console.log(JSON.stringify(process.argv))
program
  .command('upload <source> <name> <slug> <username> <token>')
  .option('-w, --wait', 'await process to finish', false)
  .description('Upload a file to MapBox through staging on S3.', {
    source: 'File to upload (path).',
    name: 'Name of the file in MapBox.',
    slug: 'Slug name of the file in MapBox, overwrites if already present.',
    username: 'Your MapBox username.',
    token: 'Your MapBox token used for uploading.',
  })
  .action(async (source, name, slug, username, token, options) => {
    await upload(source, name, slug, username, token, options.wait);
  });

program.parse(process.argv);
