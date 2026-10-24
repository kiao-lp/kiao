#!/usr/bin/env python3
# Qualify an installed Pi against simulated model and MCP endpoints, with the production KIAO bridge.
import os, json, pathlib, tempfile, threading, http.server, subprocess, queue, hashlib, time
ROOT = pathlib.Path(tempfile.mkdtemp(prefix='kiao-pi-qualification-'))
CLI = os.environ['KIAO_PI_QUALIFY_CLI']
OUTPUT = pathlib.Path(os.environ.get('KIAO_PI_QUALIFY_OUTPUT', str(ROOT)))
OUTPUT.mkdir(parents=True, exist_ok=True)
LOG = []
DENY_NESTED = False
HOLD_PERMISSIONS = False

class API(http.server.BaseHTTPRequestHandler):

    def log_message(self, *args):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        LOG.append({'auth': self.headers.get('Authorization'), 'request': req})
        tools = req.get('tools', [])
        last = req['messages'][-1]
        text = last.get('content', '')
        if last['role'] == 'user' and 'SLOW' in str(text):
            time.sleep(0.4)
        if any((t['function']['name'] == 'codemode' for t in tools)) and last['role'] != 'tool' and ('MCP' in str(text)):
            delta = {'tool_calls': [{'index': 0, 'id': 'call_mcp', 'type': 'function', 'function': {'name': 'codemode', 'arguments': json.dumps({'code': 'return await Promise.all([tools.mcp__fixture__echo({text:"auth-check"}),tools.mcp__fixture__echo({text:"parallel-check"})]);'})}}]}
            finish = 'tool_calls'
        elif last['role'] != 'tool' and 'NATIVE' in str(text):
            delta = {'tool_calls': [{'index': 0, 'id': 'call_native', 'type': 'function', 'function': {'name': 'bash', 'arguments': json.dumps({'command': 'printf kiao-native'})}}]}
            finish = 'tool_calls'
        elif last['role'] != 'tool' and 'QUESTION' in str(text):
            delta = {'tool_calls': [{'index': 0, 'id': 'call_question', 'type': 'function', 'function': {'name': 'ask_user', 'arguments': json.dumps({'question': 'Choose a colour', 'options': ['Blue', 'Red']})}}]}
            finish = 'tool_calls'
        else:
            delta = {'content': 'Bonjour\u2028Pi ✓'}
            finish = 'stop'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for obj in [{'id': 'chat-test', 'object': 'chat.completion.chunk', 'choices': [{'index': 0, 'delta': dict(role='assistant', **delta), 'finish_reason': None}]}, {'id': 'chat-test', 'object': 'chat.completion.chunk', 'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}], 'usage': {'prompt_tokens': 20, 'completion_tokens': 10, 'total_tokens': 30}}]:
            self.wfile.write(('data: ' + json.dumps(obj) + '\n\n').encode())
            self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n')
class QuietServer(http.server.ThreadingHTTPServer):
    def handle_error(self,request,address):
        pass

server = QuietServer(('127.0.0.1', 0), API)
threading.Thread(target=server.serve_forever, daemon=True).start()
state = pathlib.Path(tempfile.mkdtemp(prefix='pi-prototype-'))
work = state / 'work'
work.mkdir()
agent = state / 'agent'
agent.mkdir()
sessions = state / 'sessions'
sessions.mkdir()
(agent / 'models.json').write_text(json.dumps({'providers': {'fixture': {'api': 'openai-completions', 'baseUrl': f'http://127.0.0.1:{server.server_port}/v1', 'apiKey': '${PI_FIXTURE_KEY}', 'models': [{'id': 'fixture-gpt', 'name': 'Fixture', 'reasoning': True, 'input': ['text', 'image'], 'contextWindow': 1000, 'maxTokens': 128, 'cost': {'input': 1, 'output': 2, 'cacheRead': 0, 'cacheWrite': 0}}]}}}))
(agent / 'settings.json').write_text(json.dumps({'compaction': {'enabled': False, 'reserveTokens': 128, 'keepRecentTokens': 100}, 'retry': {'enabled': False}}))
(ROOT / 'mcp-fixture.py').write_text('import sys,os,json\nassert os.environ.get("KIAO_MCP_TURN_TOKEN")=="fixture-turn-token"\nfor line in sys.stdin:\n r=json.loads(line);m=r.get("method");v={}\n if m=="initialize":v={"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}\n elif m=="tools/list":v={"tools":[{"name":"echo","description":"Echo fixture","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}]}\n elif m=="tools/call":v={"content":[{"type":"text","text":"authenticated:"+r["params"]["arguments"]["text"]}]}\n if "id" in r: print(json.dumps({"jsonrpc":"2.0","id":r["id"],"result":v}),flush=True)\n')
(agent / 'mcp.json').write_text(json.dumps({'mcpServers': {'fixture': {'command': 'python3', 'args': [str(ROOT / 'mcp-fixture.py')], 'env': {'KIAO_MCP_TURN_TOKEN': '${KIAO_MCP_TURN_TOKEN}'}, 'exposure': 'codemode'}}}))
(ROOT / 'bridge.ts').write_text(pathlib.Path(__file__).with_name('kiao-bridge.ts').read_text())
fixtures = []

def start(session=None):
    env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent), PI_FIXTURE_KEY='fixture-api-key', KIAO_MCP_TURN_TOKEN='fixture-turn-token', KIAO_PI_PERMISSION_MODE='manual')
    args = [CLI, '--mode', 'rpc', '--no-approve', '--no-extensions', '--extension', 'builtin:mcp', '--extension', 'builtin:codemode', '--extension', str(ROOT / 'bridge.ts'), '--no-skills', '--no-prompt-templates', '--session-dir', str(sessions)]
    if session:
        args += ['--session', session]
    err = open(state / 'stderr.log', 'ab')
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, cwd=work, env=env)
    q = queue.Queue()

    def read():
        for l in p.stdout:
            try:
                r = json.loads(l)
                fixtures.append({'direction': 'out', 'record': r})
                q.put(r)
            except Exception as e:
                q.put({'type': 'bad', 'line': str(l)})
        q.put({'type': 'eof'})
    threading.Thread(target=read, daemon=True).start()
    return (p, q)
p, q = start()
import atexit
def cleanup():
    if p.poll() is None:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
atexit.register(cleanup)
counter = 0
permissions = []

def send(r):
    fixtures.append({'direction': 'in', 'record': r})
    p.stdin.write((json.dumps(r, ensure_ascii=False) + '\n').encode())
    p.stdin.flush()

def take():
    r = q.get(timeout=40)
    if r['type'] == 'extension_ui_request' and r['method'] == 'confirm':
        permission = json.loads(r['message'])
        permissions.append(permission)
        if not HOLD_PERMISSIONS:
            send({'type': 'extension_ui_response', 'id': r['id'], 'confirmed': not (DENY_NESTED and permission['tool'].startswith('mcp__fixture__'))})
    if r['type'] == 'extension_ui_request' and r['method'] == 'input':
        send({'type': 'extension_ui_response', 'id': r['id'], 'value': 'Blue'})
    if r['type'] == 'eof':
        raise Exception('EOF ' + (state / 'stderr.log').read_text())
    return r

def call(t, **kw):
    global counter
    counter += 1
    i = str(counter)
    send(dict(type=t, id=i, **kw))
    deadline=time.monotonic()+25
    while True:
        if time.monotonic()>deadline: raise TimeoutError('RPC '+t+' exceeded qualification deadline')
        r = take()
        if r.get('type') == 'response' and r.get('id') == i:
            assert r['success'], r
            return r.get('data')

def prompt(text, **fields):
    data = call('prompt', message=text, **fields)
    while True:
        r = take()
        if r['type'] == 'agent_settled':
            assert not r.get('aborted')
            break
    return call('get_state')
print('state', call('get_state'), flush=True)
models = call('get_available_models')
assert any((m['provider'] == 'fixture' for m in models['models']))
call('set_model', provider='fixture', modelId='fixture-gpt')
print('thinking', call('get_available_thinking_levels'), flush=True)
call('set_thinking_level', level='off')
image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
s = prompt('Bonjour', images=[{'type': 'image', 'mimeType': 'image/png', 'data': image}])
session = s['sessionFile']
print('session', session, flush=True)
s = prompt('Deuxième réponse')
entries = call('get_entries')['entries']
users = [e['id'] for e in entries if e.get('message', {}).get('role') == 'user']
assert len(users) == 2
before = hashlib.sha256(pathlib.Path(session).read_bytes()).hexdigest()
print('clone', call('clone'), flush=True)
clone = call('get_state')['sessionFile']
assert clone != session
assert hashlib.sha256(pathlib.Path(session).read_bytes()).hexdigest() == before
print('fork', call('fork', entryId=users[-1]), flush=True)
assert call('get_state')['sessionFile'] != clone
prompt('MCP authenticated check')
print('permissions', permissions, flush=True)
assert any((e['tool'].startswith('mcp__fixture__') for e in permissions)), permissions
prompt('Long context ' + 'fixture context. ' * 200)
print('compact', call('compact'), flush=True)
prompt('NATIVE permission check')
assert any((e['tool'] == 'bash' for e in permissions))
prompt('QUESTION user interaction')
DENY_NESTED = True
prompt('MCP denied nested check')
DENY_NESTED = False
call('prompt', message='SLOW queue and abort')
call('steer', message='steering')
call('follow_up', message='deferred')
cleared = call('clear_queue')
assert 'deferred' in cleared['followUp']
call('abort')
assert not call('get_state')['isStreaming']
HOLD_PERMISSIONS = True
call('prompt', message='MCP parked permission')
while True:
    r = take()
    if r['type'] == 'extension_ui_request' and r['method'] == 'confirm':
        break
call('clear_queue')
send({'type':'extension_ui_response','id':r['id'],'cancelled':True})
call('abort')
assert not call('get_state')['isStreaming']
HOLD_PERMISSIONS = False
print('stats', call('get_session_stats'), flush=True)
session = call('get_state')['sessionFile']
call('clear_queue')
call('abort')
p.stdin.close()
assert p.wait(timeout=15) == 0
p, q = start(session)
assert call('get_state')['sessionFile'] == session
prompt('Reprise')
p.stdin.close()
assert p.wait(timeout=15) == 0
assert all((x['auth'] == 'Bearer fixture-api-key' for x in LOG)), LOG
assert any(('data:image/png;base64,' + image in json.dumps(x['request']) for x in LOG)), 'Native image did not reach the model API'
(OUTPUT / 'rpc-fixtures.jsonl').write_text(''.join((json.dumps(f, ensure_ascii=False) + '\n' for f in fixtures)))
(OUTPUT / 'http-fixtures.json').write_text(json.dumps(LOG, ensure_ascii=False, indent=2))
print('PASS: RPC, models, native images, resume/clone/fork, compaction, MCP/Codemode, parallel and denied permissions, question, queues and parked abort', flush=True)
server.shutdown()
