import { Button, Input } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import React, { useState } from "react";

interface KeyValueMapEditorProps {
    title?: React.ReactNode;
    object: { [key: string]: string };
    setObject: (obj: { [key: string]: string }) => void;
}

export const KeyValueMapEditor: React.FC<KeyValueMapEditorProps> = ({ title, object, setObject }) => {
    const [keyName, setKeyName] = useState("");

    const setKV = (k: string, v: string) => {
        setObject({
            ...object,
            [k]: v
        });
    };

    const addK = () => {
        setObject({
            ...object,
            [keyName]: ""
        });
        setKeyName("");
    };

    const deleteK = (k: string) => {
        const newObject = { ...object };
        delete newObject[k];
        setObject(newObject);
    };

    return <div className="col">
        {title}
        {
            Object.entries(object).map(([k, v]) => (
                <div className="row" key={k}>
                    <div className="flex-1">{k}</div>
                    <div className="flex-1 row">
                        <Input type='text' value={v || ""} onChange={event => setKV(k, event.target.value)} className="flex-1" />
                        <Button icon={<DeleteOutlined />} onClick={() => deleteK(k)} danger />
                    </div>
                </div>
            ))
        }
        <div className="row">
            <div className="flex-1 row">
                <Input type='text' value={keyName} onChange={event => setKeyName(event.target.value)} className="flex-1" />
            </div>
            <div className="flex-1">
                {keyName && !Object.prototype.hasOwnProperty.call(object, keyName) && <Button icon={<PlusOutlined />} onClick={addK} />}
            </div>
        </div>
    </div>;
};
