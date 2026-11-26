const DIGITS = '零壹贰叁肆伍陆柒捌玖';
const UNITS = ['', '拾', '佰', '仟'];
const GROUPS = ['', '万', '亿', '万亿'];

/** 1..9999 -> e.g. 1005 -> 壹仟零伍 */
function group(n: number): string {
  let out = '';
  let zero = false;
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(n / 10 ** i) % 10;
    if (d === 0) { zero = out !== ''; continue; }
    out += (zero ? '零' : '') + DIGITS[d] + UNITS[i];
    zero = false;
  }
  return out;
}

/** Amount in yuan -> uppercase Chinese, e.g. 650 -> 陆佰伍拾元正. Negative or non-finite -> ''. */
export function rmbUpper(amount: number): string {
  const fen = Math.round(amount * 100); // work in whole fen to avoid float errors
  if (!Number.isFinite(fen) || fen < 0) return '';
  if (fen === 0) return '零元正';

  let rest = Math.floor(fen / 100);
  const groups: number[] = [];
  for (; rest > 0; rest = Math.floor(rest / 10000)) groups.push(rest % 10000);

  let int = '';
  let zero = false;
  for (let g = groups.length - 1; g >= 0; g--) {
    const n = groups[g];
    if (n === 0) { zero = true; continue; }
    int += (int !== '' && (zero || n < 1000) ? '零' : '') + group(n) + GROUPS[g];
    zero = false;
  }

  const jiao = Math.floor((fen % 100) / 10);
  const f = fen % 10;
  if (jiao === 0 && f === 0) return int + '元正';
  return (int ? int + '元' : '')
    + (jiao ? DIGITS[jiao] + '角' : int && f ? '零' : '')
    + (f ? DIGITS[f] + '分' : '');
}
