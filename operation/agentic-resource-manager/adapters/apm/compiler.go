package apm

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type Compiler struct{ Binary string }

func (c Compiler) Run(ctx context.Context, directory string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	binary := c.Binary
	if binary == "" {
		binary = "apm"
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = directory
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("APM %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return output, nil
}
