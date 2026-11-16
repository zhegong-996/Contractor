const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

type Choice = { project: string; projectTitle: string; agent: string; agentTitle: string; engine: string };
type Connection = { name: string; approved: boolean; choices: Choice[] };

export function runnerConnectPage(cspNonce: string, view?: Connection, error?: string) {
  const errorLine = error ? '<p role="alert">' + escape(error) + '</p>' : '';
  const choice = view?.choices.map(item => '<option value="' + escape(item.project + '/' + item.agent) + '">'
    + escape(item.projectTitle + ' · ' + item.agentTitle + ' · ' + (item.engine === 'codex' ? 'Codex' : 'Claude Code')) + '</option>').join('');
  const form = !view
    ? '<p>登录后选择这台设备可以为哪个项目接单。</p><form method="post"><input type="hidden" name="action" value="login">'
      + '<label>账号<input name="username" required autocomplete="username"></label>'
      + '<label>密码<input name="password" type="password" required autocomplete="current-password"></label>'
      + '<button>登录</button></form>'
    : view.approved ? '<p>已确认。执行端上线后会在项目的执行端列表中显示。</p>'
    : choice ? '<form method="post"><input type="hidden" name="action" value="approve">'
      + '<label>项目与 Agent<select name="selection" required><option value="">请选择</option>'
      + choice + '</select></label><button>确认连接</button></form>'
    : '<p>当前账号没有可连接的项目 Agent。请检查项目权限，以及执行机是否安装了对应 CLI。</p>';
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>连接执行端 · SuitMe</title><style nonce="' + cspNonce + '">'
    + 'body{font:16px/1.55 system-ui,sans-serif;background:#f7f8fa;color:#17202d;margin:0}'
    + 'main{max-width:420px;margin:12vh auto;padding:28px;background:white;border-radius:16px}'
    + 'form,label{display:grid;gap:8px}form{gap:16px}input,select,button{font:inherit;padding:9px 12px;border:1px solid #aab2bf;border-radius:8px}'
    + 'button{background:#17202d;color:white;cursor:pointer}h1{font-size:25px;margin:0 0 16px}[role=alert]{color:#a62222}</style>'
    + '<main><h1>连接执行端</h1>' + (view ? '<p>设备：<strong>' + escape(view.name) + '</strong></p>' : '')
    + errorLine + form + '</main></html>';
}
