import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FileDto, parentPath } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { createSimpleContext } from 'react-concise';
import { matchAppRoute, useAppRoutes } from 'src/cms-core/app-routes';

type FileBrowsingPersistenceProps = {};

export type FileBrowsingPersistenceValue = {
  currentPath: string,
  currentFile: FileDto | null;
};

const defaultValue: FileBrowsingPersistenceValue = {
  currentFile: null,
  currentPath: "",
};

const useFileBrowsingPersistence: (props: FileBrowsingPersistenceProps) => FileBrowsingPersistenceValue = () => {
  const location = useLocation();

  const [currentPath, setCurrentPath] = useState<string>("");
  const [currentFile, setStateCurrentFile] = useState<FileDto | null>(defaultValue.currentFile);
  const client = useWorkerClient();

  // Whether the URL names a **page** rather than a document — a prefix a plugin claimed, like the
  // boards, which live in a database and have no path in the store (see cms-core/app-routes).
  const routes = useAppRoutes();

  // infer currentPath from router location (location can only be a folder)
  const { pathname: rawPathname } = location;
  useEffect(() => {
    const uriComponent = decodeURIComponent(rawPathname);
    // A claimed prefix is left alone. Asking the store about it would 404, and the catch below
    // would invent a file — `boards/major`, with an extension-free name, so read as a folder and
    // set as the current path — which is a phantom document in the browser and a breadcrumb
    // pointing at nothing.
    if (matchAppRoute(routes, uriComponent)) return;
    const pathname = uriComponent.startsWith("/") ? uriComponent.substring(1) : uriComponent;

    client.getFileMetadata(pathname).then(fileDto => {

      if (fileDto.isDirectory) {
        setCurrentPath(pathname);
      } else {
        const parent = parentPath(pathname);
        setCurrentPath(parent);
      }

      setStateCurrentFile(fileDto);
    }).catch(() => {
      // Handle 404 / Error: Assume it's a new file if it has an extension
      // This allows creating new files by navigating to them
      const isDir = pathname.indexOf('.') === -1; // Naive check
      if (!isDir) {
        const parent = parentPath(pathname);
        setCurrentPath(parent);
        setStateCurrentFile({
          path: pathname,
          isDirectory: false,
          size: 0,
          lastModified: Date.now() // Fake
        });
      } else {
        // If it looks like a dir but failed, maybe just set path?
        setCurrentPath(pathname);
        setStateCurrentFile(null);
      }
    });
  }, [client, rawPathname, routes]);

  return { currentFile, currentPath };
};

const hookBasedContext = createSimpleContext(useFileBrowsingPersistence, defaultValue);

export const FileBrowsingPersistenceProvider = hookBasedContext.Provider;
export const useFileBrowsingPersistenceContext = hookBasedContext.useContext;
