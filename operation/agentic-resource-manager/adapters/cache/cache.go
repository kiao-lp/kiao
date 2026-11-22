package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
)

type Directory struct{ Root string }

func (c Directory) path(key string) string {
	digest := sha256.Sum256([]byte(key))
	return filepath.Join(c.Root, hex.EncodeToString(digest[:])+".json")
}

func (c Directory) Read(key string) ([]byte, error) { return os.ReadFile(c.path(key)) }

func (c Directory) Write(key string, data []byte) error {
	if err := os.MkdirAll(c.Root, 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(c.Root, ".package-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(data)
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), c.path(key))
}
