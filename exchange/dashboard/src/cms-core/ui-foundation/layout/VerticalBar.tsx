import { CSSProperties, FC } from "react";
import "./VerticalBar.css";

export const VerticalBar: FC<{ text?: string, style?: CSSProperties | undefined }> = ({ text, style }) =>
    <div className="vertical-bar" style={style}>
        {text}
    </div>;
