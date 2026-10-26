const [major, minor] = process.versions.node.split(".").map(Number);
const supported = major >= 24 || (major === 23 && minor >= 8) || (major === 22 && minor >= 19);
if (!supported || typeof require("node:zlib").createZstdDecompress !== "function") {
    console.error("Pi cannot run with Node.js " + process.version + ": a compatible runtime with Zstandard decompression is required. Install or update Node.js LTS in Configuration.");
    process.exit(1);
}
