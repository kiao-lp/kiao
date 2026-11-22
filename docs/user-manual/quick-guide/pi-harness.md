---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Pi (Harness)

Pi can work in a free conversation or play a hybridflow task. It needs a compatible Node.js runtime
with Zstandard support (22.19+, 23.8+ or 24+) and
access to a supported model API. A local compatible API can be used without a paid account.

1. Open **Configuration** and install **Pi (Harness) 1.5.2**. Update Node.js there if necessary.
2. Open **Pi (harness)** from the Tools menu or Configuration. Create a named profile and select its Pi installation.
3. Add a connection: give it a name, select its API format and enter its **base URL**. For example,
   DeepSeek uses `https://api.deepseek.com`; Pi adds `/chat/completions` itself. Choose a stored key
   or click **Add API key** to store and attach one. **Environment variable (advanced)** uses a
   variable set on the runner; **No API key (local API)** is for endpoints that require no key.
4. Add the model IDs allowed through that connection. **Model capabilities and limits** holds
   reasoning/image support, the reasoning levels Pi may offer, and token limits. X-High and Max stay
   hidden until selected. The first model becomes the default; **Use by default**
   selects another. This chooses an existing model for turns that do not specify one.
5. Changes save automatically. A **Changes not saved** message identifies incomplete or rejected
   edits; checks wait for a successful save. **Check models** verifies only the model IDs you added
   and lists their capabilities; it does not discover the provider's models or verify API access.
   **Test API connection** sends a small request using the default model to verify the endpoint and key.
   **API request failed** shows the API error details, such as a rejected key or unknown model.
   **Pi stopped unexpectedly** means the runtime stopped before verification; it does not establish
   whether the connection works. Expand **Technical details** for its exit status and redacted error
   output. Retry the test; if it repeats, include those details when reporting the problem.
   An error mentioning `createZstdDecompress` means Pi is using an incompatible Node.js runtime;
   install or update Node.js LTS. It does not indicate that your API key was rejected.
6. In **Agents**, create an agent on **Pi (Harness)**, select its profile and model, and publish it.
   Choose the agent in **New conversation** or in a board task.

A profile can supply several agents with the same connections. Each agent supplies its own
instructions, skills and tools.

The **API keys** tab lists every stored private key, its masked preview and the profiles/connections
using it. **Show key** reveals its value on request, **Hide key** masks it again, and **Remove key**
deletes it from the runner. Connections still referring to a deleted key show **Key missing** and
need a replacement. Environment variables are managed on the runner and are not stored keys.

During a turn, choose **Steer now** to redirect the work or **After current work** to queue another
message. The queue shows delivery and cancellation. **Stop** cancels pending messages and waits for
the running work to stop. Questions always wait for your answer; permission modes control tools.

A conversation keeps the profile and model resolved from its agent publication. To use a
different profile or model, select another publication when forking. A fork onto a different Pi
profile starts a separate session with the copied transcript as context. Use **Compact** to
reduce the context of the current session.

Profiles are local to the runner. A task referring to a missing profile is refused with an
explanation; choose a runner equipped with that profile. Existing conversations remain readable.
Keys are kept by the worker and do not appear in boards or transcripts. Updates preserve profiles
and native sessions. A Pi version used by a profile must be replaced there before it is removed.

After upgrading kiao, install Pi 1.5.2 and select it in each profile that uses an older installation.
For an external installation, update its executable and redeclare it in **Advanced** with the same
installation name. Existing profiles and conversations keep their settings and session history.

See the [profile and protocol reference](/operation/worker/PROTOCOL/pi.md) for configuration fields,
installation declarations, pinned extensions and the supported browser interactions.
