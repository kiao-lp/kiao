package config

// AskUserQuestion uses can_use_tool and receives answers through updatedInput.
// Treat it as a question, never a permission: bypass and manualLive auto-approval
// must not answer on the user's behalf.
const ClaudeAskQuestionTool = "AskUserQuestion"
