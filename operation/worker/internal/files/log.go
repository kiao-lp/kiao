package files

import "kiao/worker/internal/core"

// Per-subsystem loggers, one per former bracketed prefix, so a line stays filterable with
// `component=<name>`. Package-level vars, so a call site is a single method invocation with no
// per-call allocation.
var (
	logGit        = core.Component("git")        // git command execution
	logMigrate    = core.Component("migrate")    // file-store migrations
	logSearch     = core.Component("search")     // search-time PDF indexing
	logIndex      = core.Component("index")      // index file cleanup
	logSubsidiary = core.Component("subsidiary") // companion-file moves/deletes
	logLinkFix    = core.Component("linkfix")    // link-fix pass cost, and the delete/move phases around it
	logStaging    = core.Component("staging")    // upload staging areas: opened, discarded, swept
	logOptimize   = core.Component("optimize")   // the duplicate/big-file scan, and consolidations
	logMedia      = core.Component("media")      // a video's segments saved as files, by ffmpeg
)
