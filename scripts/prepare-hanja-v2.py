"""Build an auditable input from pinned court snapshot, libhangul and Unihan.

Run in SZ_PROJECT_BE: python3 scripts/prepare-hanja-v2.py /path/Unihan.zip
Downloaded source files are in .local/hanja-replacement. No network requests.
"""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile
from hanja_gloss import parse_glosses

root = Path('.local/hanja-replacement')
archive = Path(sys.argv[1])
totals, korean = {}, {}
with zipfile.ZipFile(archive) as source:
    for filename in source.namelist():
        for line in source.read(filename).decode().splitlines():
            if not line.startswith('U+'):
                continue
            code, field, value = line.split('\t')
            char = chr(int(code[2:], 16))
            if field == 'kTotalStrokes':
                totals[char] = int(value)
            elif field == 'kAlternateTotalStrokes':
                for alternate in value.split():
                    if ':' in alternate:
                        count, regions = alternate.split(':')
                        if 'K' in regions:
                            korean[char] = int(count)

dictionary = {}
dictionary_path = root / 'libhangul-hanja.txt'
for line in dictionary_path.read_text().splitlines():
    fields = line.split(':', 2)
    if len(fields) == 3 and re.fullmatch('[가-힣]', fields[0]) and len(fields[1]) == 1:
        dictionary[fields[0], fields[1]] = fields[2]

pairs = sorted({(reading, row['hanja'])
    for row in csv.DictReader((root / 'Korean-Name-Hanja-Charset-data-gov.csv').open())
    for reading in row['hangul'].split(',')})
rows, excluded, raw_glosses = [], [], []
for reading, character in pairs:
    if not re.fullmatch('[가-힣]', reading) or len(character) != 1 or character not in totals:
        excluded.append({'reading': reading, 'character': character, 'reason': 'unsupported-codepoint-or-reading'})
        continue
    raw = dictionary.get((reading, character), '')
    meanings = parse_glosses(raw, reading)
    rows.append({'reading': reading, 'character': character, 'meanings': meanings,
                 'writtenStrokes': korean.get(character, totals[character])})
    raw_glosses.append({'reading': reading, 'character': character, 'raw': raw, 'meanings': meanings})

lib = json.loads((root / 'libhangul-source.json').read_text())
court = json.loads((root / 'Korean-Name-Hanja-Charset-source.json').read_text())
sources = {
    'courtSnapshot': court['files']['Korean-Name-Hanja-Charset-data-gov.csv'],
    'dictionary': lib['files']['libhangul-hanja.txt'],
    'writtenStrokes': 'https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip',
}
hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [
    root / 'Korean-Name-Hanja-Charset-data-gov.csv', dictionary_path, archive,
]}
data = {'sources': sources, 'hashes': hashes, 'rows': rows}
(root / 'prepared.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
(root / 'gloss-audit.json').write_text(json.dumps(raw_glosses, ensure_ascii=False, indent=2) + '\n')
report = {'rows': len(rows), 'readings': len({r['reading'] for r in rows}),
          'meaningAvailable': sum(bool(r['meanings']) for r in rows),
          'meaningUnavailable': sum(not r['meanings'] for r in rows),
          'excluded': excluded, 'sources': sources, 'hashes': hashes}
(root / 'source-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
# The dictionary data has its own BSD notice, independent of the library LGPL.
notice = '\n'.join(line.removeprefix('#').lstrip() for line in dictionary_path.read_text().splitlines() if line.startswith('#'))
Path('src/data/LIBHANGUL-DATA-LICENSE.txt').write_text(notice + '\n')
Path('src/data/COURT-SNAPSHOT-LICENSE.txt').write_text((root / 'Korean-Name-Hanja-Charset-LICENSE').read_text())
print(json.dumps({k: report[k] for k in ['rows', 'readings', 'meaningAvailable', 'meaningUnavailable']}, ensure_ascii=False))
