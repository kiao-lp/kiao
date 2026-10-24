# Copy text files between Kiao instances

Open both instances in a browser that allows clipboard access. Use HTTPS or a localhost
address so the browser makes its clipboard available.

1. In the source instance, right-click a text file in **File Tree** and choose
   **Copy as... → Copy text files with contents**. For several files, select them in the
   file browser first, then right-click one of the selected files.
2. In the destination instance, right-click the destination folder in **File Tree** and
   choose **Paste text files**. The store root and the file browser's empty area also
   offer this command.

The clipboard carries each file's name and complete text. Markdown, JSON, SVG, source code
and configuration files are supported when encoded as UTF-8. A selection containing a
folder or a binary file does not offer the copy command. Linked files and subfolders are
not included.

Pasting creates the files directly in the selected folder. Existing files keep their
contents; a pasted file with the same name receives a number before its extension.
**Paste text files** appears when the clipboard contains files copied with this command.
Allow clipboard access if the browser requests it.
