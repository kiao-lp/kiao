import React, { useEffect, useState } from 'react';
import { usePluginListContext } from '../../core/PluginList-ctx';
import { FileTypeConfig } from '../../core/FileBasedPlugin';
import { FileDto, extractName } from 'src/cms-core/files/service';

import defaultIconImg from './file.svg';

export interface FileLabelSwitchProps {
  file: FileDto;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const FileLabelSwitch: React.FC<FileLabelSwitchProps> = ({ file }) => {
  const { findFilePlugin } = usePluginListContext();
  const [fileConfig, setFileConfig] = useState<FileTypeConfig | null>(null);

  useEffect(() => {
    setFileConfig(findFilePlugin(file)?.fileConfigFor(file) || null);
  }, [findFilePlugin, file]);

  const fileTitle = extractName(file.path);

  return <div className='file-label'>
    {fileConfig ? <fileConfig.fileLabelCmp file={file} /> : <><img src={defaultIconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>}
  </div>;
}
