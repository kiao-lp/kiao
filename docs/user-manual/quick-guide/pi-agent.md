# Pi (Agent)

Pi can work in a free conversation or play a hybridflow task. It needs a compatible Node.js runtime
with Zstandard support (22.19+, 23.8+ or 24+) and
access to a supported model API. A local compatible API can be used without a paid account.

1. Open **Configuration** and install **Pi (Agent) 1.3.0**. Update Node.js there if necessary.
2. Open **Pi profiles** from the Tools menu or Configuration. It has its own panel, initially in
   the centre, and can be moved with **Show**. Create a named profile and select its Pi installation.
3. Add a connection: give it a name, select its API format and enter its **base URL**. For example,
   DeepSeek uses `https://api.deepseek.com`; Pi adds `/chat/completions` itself. Choose a stored key
   or click **Add API key** to store and attach one. **Environment variable (advanced)** uses a
   variable set on the runner; **No API key (local API)** is for endpoints that require no key.
4. Add the model IDs allowed through that connection. **Model capabilities and limits** holds
   reasoning/image support and token limits. The first model becomes the default; **Use by default**
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
6. Create a **Pi (Agent)** conversation, then select its profile and model. In hybridflow, create
   an agent on platform **Pi (Agent)** and give it the same profile reference and a model.

One profile may contain an OpenAI connection for GPT and a DeepSeek connection for DeepSeek models.
Several agents and free conversations can share it. Agent instructions belong to the agent;
a free conversation sharing its profile does not inherit them.

The **API keys** tab lists every stored private key, its masked preview and the profiles/connections
using it. **Show key** reveals its value on request, **Hide key** masks it again, and **Remove key**
deletes it from the runner. Connections still referring to a deleted key show **Key missing** and
need a replacement. Environment variables are managed on the runner and are not stored keys.

During a turn, choose **Steer now** to redirect the work or **After current work** to queue another
message. The queue shows delivery and cancellation. **Stop** cancels pending messages and waits for
the running work to stop. Questions always wait for your answer; permission modes control tools.

A conversation keeps its profile. Selecting another profile forks it into a separate session with
the prior transcript as context. You can change models within one profile between turns. Use
**Compact** to reduce an existing session, or fork from a prompt to try another continuation.

Profiles are local to the runner. A task referring to a missing profile is refused with an
explanation; choose a runner equipped with that profile. Existing conversations remain readable.
Keys are kept by the worker and do not appear in boards or transcripts. Updates preserve profiles
and native sessions. A Pi version used by a profile must be replaced there before it is removed.

See the [profile and protocol reference](/operation/worker/PROTOCOL/pi.md) for configuration fields,
installation declarations, pinned extensions and the supported browser interactions.
