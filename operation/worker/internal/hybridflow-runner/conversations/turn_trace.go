package conversations

import (
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"os"
	"path/filepath"
	"strings"
)

func (s *ConversationStore) OpenTurnTrace(conversationID, turnID string, stream bool, secrets []string) *turntrace.TurnTrace {
	if s == nil || !ConversationIDRe.MatchString(conversationID) || strings.TrimSpace(turnID) == "" {
		return nil
	}
	dir := filepath.Join(s.ConvDir(conversationID), turntrace.TurnsDirName)
	if err := os.MkdirAll(dir, turntrace.TraceDirPerm); err != nil {
		turntrace.LogConv.Warn("cannot open the turn trace",
			"conversation", conversationID, "turn", turnID, "error", err)
		return nil
	}
	turntrace.PruneTurnTraces(dir, turntrace.MaxTurnTraces-1)

	file, err := os.OpenFile(filepath.Join(dir, turnID+turntrace.TraceFileExt),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND, turntrace.TraceFilePerm)
	if err != nil {
		turntrace.LogConv.Warn("cannot open the turn trace",
			"conversation", conversationID, "turn", turnID, "error", err)
		return nil
	}
	kept := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		if strings.TrimSpace(secret) != "" {
			kept = append(kept, secret)
		}
	}
	return turntrace.NewTurnTrace(file, stream, kept)
}
