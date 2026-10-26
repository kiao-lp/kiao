const TEXT_EXTENSIONS = new Set([
    '.md', '.markdown', '.mdx', '.txt', '.text', '.log', '.csv', '.tsv', '.json', '.jsonl',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties',
    '.xml', '.html', '.htm', '.svg', '.adoc', '.rst', '.tex', '.srt', '.vtt', '.sql',
    '.go', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
    '.java', '.rs', '.py', '.kt', '.kts', '.cls', '.c', '.h', '.cc', '.cpp', '.hpp',
    '.cs', '.css', '.scss', '.sass', '.less', '.dart', '.swift', '.rb', '.php', '.lua', '.r',
    '.vue', '.svelte', '.graphql', '.gql', '.proto', '.diff', '.patch',
]);

const TEXT_FILENAMES = new Set([
    'go.mod', 'go.sum', 'go.work', 'go.work.sum', '.gitignore', '.gitattributes',
    '.kiao-files', '.env', '.editorconfig', '.npmrc', '.dockerignore',
    'dockerfile', 'containerfile', 'makefile', 'readme', 'license', 'licence',
]);

/** Text formats readable without converting a binary document. */
export const isReadableAsText = (path: string): boolean => {
    const name = path.toLowerCase().split('/').pop() ?? '';
    const dot = name.lastIndexOf('.');
    return TEXT_FILENAMES.has(name) || (dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot)));
};
