// What marrow prints when gh is not installed.
process.stderr.write('No GitHub credentials found. Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, or set GITHUB_TOKEN.\n');
process.exit(1);
