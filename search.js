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

const _CALC_MATH_FUNCS = [
    'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'log2', 'log10', 'log', 'exp', 'abs', 'ceil', 'floor', 'round',
    'pow', 'max', 'min'
];

const _CALC_DISPLAY_PRECISION = 10;

export function calculateExpression(text) {
    if (!text || text.trim() === '') return null;
    let expr = text.trim();

    // Must contain at least one math operator or start with a known math function
    let hasBinaryOp = /[+\-*/%^]/.test(expr);
    let startsWithFn = /^(sqrt|sin|cos|tan|asin|acos|atan|log|exp|abs|ceil|floor|round|pow|max|min)\s*\(/i.test(expr);
    if (!hasBinaryOp && !startsWithFn) return null;

    // Allow only digits, spaces, operators, parentheses, dots, commas, and letters
    if (!/^[\d\s+\-*/%^().,'a-zA-Z]+$/.test(expr)) return null;

    // Extract all alphabetic identifiers and validate them
    let ids = expr.match(/[a-zA-Z]+/g) || [];
    for (let id of ids) {
        if (!_CALC_ALLOWED_IDS.has(id.toLowerCase())) return null;
    }

    try {
        let safeExpr = expr;
        safeExpr = safeExpr.replace(/\^/g, '**');
        safeExpr = safeExpr.replace(/\bpi\b/gi, 'Math.PI');
        safeExpr = safeExpr.replace(/\be\b/gi, 'Math.E');

        for (let fn of _CALC_MATH_FUNCS) {
            safeExpr = safeExpr.replace(new RegExp(`\\b${fn}\\b`, 'gi'), `Math.${fn}`);
        }

        // eslint-disable-next-line no-new-func
        let result = Function('"use strict"; return (' + safeExpr + ')')();

        if (typeof result !== 'number' || !isFinite(result)) return null;

        let formatted = Number.isInteger(result)
            ? result.toString()
            : parseFloat(result.toPrecision(_CALC_DISPLAY_PRECISION)).toString();

        return {
            type: 'calc',
            name: `${expr} = ${formatted}`,
            description: 'Calculator',
            result: formatted,
            expression: expr,
            icon: new Gio.ThemedIcon({ name: 'accessories-calculator' })
        };
    } catch (e) {
        return null;
    }
}