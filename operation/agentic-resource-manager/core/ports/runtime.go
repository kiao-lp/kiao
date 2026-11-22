package ports

import "context"

type GitController interface {
	Run(ctx context.Context, directory string, args ...string) ([]byte, error)
}

type Compiler interface {
	Run(ctx context.Context, directory string, args ...string) ([]byte, error)
}

type PackageCache interface {
	Read(key string) ([]byte, error)
	Write(key string, data []byte) error
}
