"""Extract the used characters' written strokes from the official Unicode 17 archive.

Usage: python3 scripts/build-written-strokes.py Unihan.zip
Run from SZ_PROJECT_BE. Retain the accompanying Unicode license.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

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

catalog = json.loads(Path('.local/hanja/catalog-gang.json').read_text())
characters = {item['entry']['character'] for item in catalog['entries']}
characters.update(item['character'] for item in json.loads(Path('../SZ_PROJECT_FE/src/data/hanja-example-ids.json').read_text()))
data = {
    'version': 'Unicode-17.0.0',
    'source': 'https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip',
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'rule': 'kAlternateTotalStrokes K override when present; otherwise kTotalStrokes. No radical expansion.',
    'strokes': {c: korean.get(c, totals[c]) for c in sorted(characters) if c in totals},
}
for root in [Path('.'), Path('../SZ_PROJECT_FE')]:
    (root / 'src/data/written-strokes.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'characters': len(characters), 'covered': len(data['strokes']), 'missing': sorted(characters - data['strokes'].keys())}, ensure_ascii=False))
