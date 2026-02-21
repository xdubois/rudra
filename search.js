import Gio from 'gi://Gio';
import GLib from 'gi://GLib';


export function searchApps(text, limit = 50) {
    if (!text || text.trim() === '') return [];
    let query = text.trim().toLowerCase();

    let allApps = Gio.AppInfo.get_all();
    let matches = [];

    allApps.forEach(app => {
        let name = app.get_name();
        let id = app.get_id();

        if (!name) return;
        name = name.toLowerCase();
        id = id ? id.toLowerCase() : '';

        let isSetting = id.includes('gnome-control-center') ||
                        id.includes('panel') ||
                        id.includes('org.gnome.settings');

        if (!app.should_show() && !isSetting) return;

        if (name.includes(query) || id.includes(query)) {
            matches.push({
                type: 'app',
                name: app.get_name(),
                description: app.get_description(),
                id: app.get_id(),
                icon: app.get_icon(),
                appInfo: app,
                isSetting: isSetting
            });
        }
    });

    return matches.sort((a, b) => {
        let nameA = a.name.toLowerCase();
        let nameB = b.name.toLowerCase();
        let startA = nameA.startsWith(query);
        let startB = nameB.startsWith(query);

        if (startA && !startB) return -1;
        if (startB && !startA) return 1;
        return nameA.localeCompare(nameB);
    }).slice(0, limit);
}

let _findProc = null;

export function searchFiles(text, callback) {
    if (!text || !text.startsWith('.')) {
        callback([]);
        return;
    }

    let query = text.substring(1).trim();
    if (query.length < 2) {
        callback([]);
        return;
    }

    if (_findProc) {
        try { _findProc.force_exit(); } catch (e) { }
        _findProc = null;
    }

    let homePath = GLib.get_home_dir();
    let argv = [
        'find',
        homePath,
        '-maxdepth', '3',
        '-not', '-path', '*/.*',
        '-iname', `*${query}*`
    ];

    try {
        _findProc = new Gio.Subprocess({
            argv: argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
        });
        _findProc.init(null);

        let proc = _findProc;

        proc.communicate_utf8_async(null, null, (p, res) => {
            if (_findProc !== proc) return;
            _findProc = null;

            try {
                let [ok, stdout] = p.communicate_utf8_finish(res);
                if (!ok) { callback([]); return; }

                let lines = stdout.trim().split('\n');
                let results = [];

                for (let path of lines) {
                    if (!path || path.trim() === '') continue;
                    let file = Gio.File.new_for_path(path);
                    results.push({
                        type: 'file',
                        name: file.get_basename(),
                        description: path.replace(homePath, '~'),
                        icon: _getFileIcon(file),
                        file: file
                    });
                }

                callback(results);

            } catch (e) {
                console.error('searchFiles result error:', e);
                callback([]);
            }
        });

    } catch (e) {
        console.error('searchFiles spawn error:', e);
        _findProc = null;
        callback([]);
    }
}

function _getFileIcon(file) {
    try {
        let info = file.query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_icon();
    } catch (e) {
        return new Gio.ThemedIcon({ name: 'text-x-generic' });
    }
}

const _CALC_ALLOWED_IDS = new Set([
    'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'log', 'log2', 'log10', 'exp', 'abs', 'ceil', 'floor', 'round',
    'pow', 'max', 'min', 'pi', 'e'
]);

let _calcProc = null;

export function calculateExpression(text, callback) {
    if (!text || text.trim() === '') {
        callback(null);
        return;
    }
    let expr = text.trim();

    // Must contain at least one math operator or start with a known math function
    let hasBinaryOp = /[+\-*/%^]/.test(expr);
    let startsWithFn = /^(sqrt|sin|cos|tan|asin|acos|atan|log|exp|abs|ceil|floor|round|pow|max|min)\s*\(/i.test(expr);
    if (!hasBinaryOp && !startsWithFn) {
        callback(null);
        return;
    }

    // Allow only digits, spaces, operators, parentheses, dots, commas, and letters
    if (!/^[\d\s+\-*/%^().,'a-zA-Z]+$/.test(expr)) {
        callback(null);
        return;
    }

    // Validate all alphabetic identifiers against the whitelist
    let ids = expr.match(/[a-zA-Z]+/g) || [];
    for (let id of ids) {
        if (!_CALC_ALLOWED_IDS.has(id.toLowerCase())) {
            callback(null);
            return;
        }
    }

    // Cancel any pending calculation
    if (_calcProc) {
        try { _calcProc.force_exit(); } catch (e) { /* ignore - process may have already exited */ }
        _calcProc = null;
    }

    // Expression is validated by the whitelist above and sent via stdin (not a shell argument),
    // so there is no shell injection risk.
    try {
        _calcProc = new Gio.Subprocess({
            argv: ['gcalccmd'],
            flags: Gio.SubprocessFlags.STDIN_PIPE |
                   Gio.SubprocessFlags.STDOUT_PIPE |
                   Gio.SubprocessFlags.STDERR_SILENCE
        });
        _calcProc.init(null);

        let proc = _calcProc;

        proc.communicate_utf8_async(expr + '\n', null, (p, res) => {
            if (_calcProc !== proc) return;
            _calcProc = null;

            try {
                let [ok, stdout] = p.communicate_utf8_finish(res);
                if (!ok || !stdout) { callback(null); return; }

                let result = null;
                for (let line of stdout.split('\n')) {
                    line = line.trim();
                    if (line.startsWith('= ')) {
                        result = line.substring(2).trim();
                        break;
                    }
                }
                if (!result) { callback(null); return; }

                callback({
                    type: 'calc',
                    name: `${expr} = ${result}`,
                    description: 'Calculator',
                    result: result,
                    expression: expr,
                    icon: new Gio.ThemedIcon({ name: 'accessories-calculator' })
                });
            } catch (e) {
                console.error('calculateExpression error:', e);
                callback(null);
            }
        });
    } catch (e) {
        _calcProc = null;
        callback(null);
    }
}