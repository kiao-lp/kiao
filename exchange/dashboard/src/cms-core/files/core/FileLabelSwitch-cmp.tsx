import React, { useEffect, useState } from 'react';
import { usePluginListContext } from '../../core/PluginList-ctx';
import { FileTypeConfig } from '../../core/FileBasedPlugin';
import { FileDto, extractName } from 'src/cms-core/files/service';

import defaultIconImg from './file.svg';

export interface FileLabelSwitchProps {
  file: FileDto;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  hideIconIfSingleChar?: boolean;
}

export const FileLabelSwitch: React.FC<FileLabelSwitchProps> = ({ file, hideIconIfSingleChar }) => {
  const { findFilePlugin } = usePluginListContext();
  const [fileConfig, setFileConfig] = useState<FileTypeConfig | null>(null);

  useEffect(() => {
    setFileConfig(findFilePlugin(file)?.fileConfigFor(file) || null);
  }, [findFilePlugin, file]);

  const isSingleGrapheme = (str: string) => {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const segmenter = new (Intl as any).Segmenter("en", { granularity: "grapheme" });
      return Array.from(segmenter.segment(str)).length === 1;
    }
    return Array.from(str).length === 1;
  };

  const fileTitle = extractName(file.path);

  if (hideIconIfSingleChar && file.isDirectory && isSingleGrapheme(fileTitle)) {
    return <div className='file-label'>{fileTitle}</div>;
  }

  return <div className='file-label'>
    {fileConfig ? <fileConfig.fileLabelCmp file={file} /> : <><img src={defaultIconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>}
  </div>;
}
