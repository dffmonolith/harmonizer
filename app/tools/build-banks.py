#!/usr/bin/env python3
"""
build-banks.py -- makes Harmonizer's instrument sound banks (v3.0) from a General MIDI SoundFont.

  python3 build-banks.py GeneralUser-GS.sf2 ..        (writes ../harmonizer-bank-*.json)

Source used for the shipped banks: GeneralUser GS v2.0.3 by S. Christian Collins
(https://www.schristiancollins.com, https://github.com/mrbumpy409/GeneralUser-GS).
Its license allows use and redistribution in software projects; the author asks that
websites host their own copy rather than link to his download files -- which is what this does.

Each bank is one JSON file, loaded by Harmonizer only when a stave actually plays it:
  { format: "harmonizer-bank-1", id, name, source, env: {attack, release} (seconds),
    zones: [ { lo, hi, root (MIDI, fractional = tuning), rate, loopStart, loopEnd (frames),
               gain, pcm (base64, 16-bit little-endian mono) } ] }
PCM is kept uncompressed on purpose: loop points must be sample-exact, and MP3's
encoder delay would shift them.
"""
import struct, sys, os, json, base64, math
import numpy as np
GEN = {0:'startAddrsOffset',1:'endAddrsOffset',2:'startloopAddrsOffset',3:'endloopAddrsOffset',4:'startAddrsCoarseOffset',
 8:'initialFilterFc',9:'initialFilterQ',12:'endAddrsCoarseOffset',17:'pan',33:'delayVolEnv',34:'attackVolEnv',35:'holdVolEnv',36:'decayVolEnv',37:'sustainVolEnv',38:'releaseVolEnv',
 41:'instrument',43:'keyRange',44:'velRange',45:'startloopAddrsCoarseOffset',48:'initialAttenuation',50:'endloopAddrsCoarseOffset',51:'coarseTune',52:'fineTune',53:'sampleID',54:'sampleModes',56:'scaleTuning',58:'overridingRootKey'}
class SF2:
    def __init__(self, path):
        d = open(path,'rb').read(); self.d=d
        assert d[:4]==b'RIFF' and d[8:12]==b'sfbk'
        self.chunks={}
        p=12
        while p < len(d):
            cid=d[p:p+4]; sz=struct.unpack('<I',d[p+4:p+8])[0]
            if cid==b'LIST':
                typ=d[p+8:p+12]; q=p+12; end=p+8+sz
                while q<end:
                    c2=d[q:q+4]; s2=struct.unpack('<I',d[q+4:q+8])[0]
                    self.chunks[c2.decode('latin1')]=(q+8,s2); q+=8+s2+(s2&1)
            p+=8+sz+(sz&1)
        def recs(name,fmt):
            off,sz=self.chunks[name]; n=struct.calcsize(fmt)
            return [struct.unpack(fmt,d[off+i:off+i+n]) for i in range(0,sz,n)]
        self.phdr=recs('phdr','<20sHHHIII'); self.pbag=recs('pbag','<HH'); self.pgen=recs('pgen','<HH')
        self.inst=recs('inst','<20sH'); self.ibag=recs('ibag','<HH'); self.igen=recs('igen','<HH')
        self.shdr=recs('shdr','<20sIIIIIBbHH')
        self.smpl=self.chunks['smpl']
    @staticmethod
    def amt(op,raw):
        if op in (43,44): return (raw&255, raw>>8)
        if op in (41,53,54,58): return raw
        return raw-65536 if raw>=32768 else raw
    def zones(self, bags, gens, b0, b1):
        out=[]
        for b in range(b0,b1):
            g0=bags[b][0]; g1=bags[b+1][0]; z={}
            for op,raw in gens[g0:g1]: z[GEN.get(op,op)]=self.amt(op,raw)
            out.append(z)
        return out
    def preset(self, bank, prog):
        for i,h in enumerate(self.phdr[:-1]):
            if h[1]==prog and h[2]==bank:
                return h[0].split(b'\0')[0].decode('latin1'), self.zones(self.pbag,self.pgen,h[3],self.phdr[i+1][3])
    def instrument(self, idx):
        h=self.inst[idx]; return h[0].split(b'\0')[0].decode('latin1'), self.zones(self.ibag,self.igen,h[1],self.inst[idx+1][1])
    def sample(self, idx):
        s=self.shdr[idx]; return dict(name=s[0].split(b'\0')[0].decode('latin1'),start=s[1],end=s[2],sl=s[3],el=s[4],rate=s[5],pitch=s[6],corr=s[7],link=s[8],type=s[9])
    def pcm(self, a, b):
        off,_=self.smpl; return self.d[off+2*a: off+2*b]

def tc_sec(tc): return 2 ** (tc / 1200.0)

# id, display name, GM bank/program, which instrument(s) of the preset to take, every-nth-zone thinning, envelope, level trim
BANKS = [
  ('choir-aah', 'Choir Aahs', 0, 52, 'Concert Choir', 1, {'attack': 0.12, 'release': 0.35}, 1.00),
  ('organ',     'Organ',      8, 19, 'Pipe Organ 8va', 1, {'attack': 0.02, 'release': 0.15}, 0.85),
  ('strings',   'Strings',    0, 48, 'Strings_1',     2, {'attack': 0.10, 'release': 0.30}, 1.00),
  ('flute',     'Flute',      0, 73, 'Flute',         1, {'attack': 0.04, 'release': 0.15}, 0.95),
]
TARGET_RMS = 0.065      # sustained level; the piano's first half-second is ~0.09 RMS

def build(sf, spec, outdir):
    bid, title, bank, prog, instName, thin, env, trim = spec
    pname, pzones = sf.preset(bank, prog)
    pglob = pzones[0] if pzones and 'instrument' not in pzones[0] else {}
    # the preset layer used: the first one naming the wanted instrument whose velocity range covers ~100
    layer = None
    for z in pzones:
        if 'instrument' not in z: continue
        if sf.instrument(z['instrument'])[0] != instName: continue
        lo, hi = z.get('velRange', (0, 127))
        if lo <= 100 <= hi or layer is None: layer = z
    iname, izones = sf.instrument(layer['instrument'])
    iglob = izones[0] if izones and 'sampleID' not in izones[0] else {}
    def g(z, k, dflt=0):  # instrument zone value (zone overrides global) + preset additive value
        base = z.get(k, iglob.get(k, dflt))
        if k in ('coarseTune', 'fineTune', 'initialAttenuation'):
            base += layer.get(k, pglob.get(k, 0))
        return base
    raw = [z for z in izones if 'sampleID' in z]
    # merge neighbouring zones that use the same sample (they differ only in filter etc.)
    merged = []
    for z in raw:
        kr = z.get('keyRange', (0, 127))
        if merged and merged[-1]['z']['sampleID'] == z['sampleID'] and merged[-1]['hi'] + 1 == kr[0]:
            merged[-1]['hi'] = kr[1]
        else:
            merged.append({'z': z, 'lo': kr[0], 'hi': kr[1]})
    if thin > 1: merged = merged[::thin]   # keep every nth sample (re-spread below)
    zones_out = []
    for m in merged:
        z = m['z']; s = sf.sample(z['sampleID'])
        start = s['start'] + g(z, 'startAddrsOffset') + 32768 * g(z, 'startAddrsCoarseOffset')
        ls = s['sl'] + g(z, 'startloopAddrsOffset'); le = s['el'] + g(z, 'endloopAddrsOffset')
        pcm = np.frombuffer(sf.pcm(start, le), dtype='<i2').astype(np.float64) / 32768.0
        root_key = g(z, 'overridingRootKey', -1)
        if root_key < 0 or root_key > 127: root_key = s['pitch']
        # sounding pitch of the sample when played at its root key = root - coarse - fine/100 - corr/100
        root = root_key - g(z, 'coarseTune') - (g(z, 'fineTune') + s['corr']) / 100.0
        loopS, loopE = ls - start, le - start
        loop = pcm[loopS:loopE]
        rms = float(np.sqrt((loop ** 2).mean())) or 1e-6
        peak = float(np.abs(pcm).max()) or 1e-6
        norm = 0.95 / peak                       # store at full scale...
        gain = TARGET_RMS / (rms * norm) * trim  # ...and tell the player how far to turn it down
        ints = np.clip(np.round(pcm * norm * 32767), -32768, 32767).astype('<i2')
        zones_out.append({'lo': m['lo'], 'hi': m['hi'], 'root': round(root, 3), 'rate': s['rate'],
                          'loopStart': int(loopS), 'loopEnd': int(loopE), 'gain': round(gain, 4),
                          'sample': s['name'], 'pcm': base64.b64encode(ints.tobytes()).decode('ascii')})
    # Key ranges come from the samples' measured roots, not the SoundFont's own ranges: every
    # key plays the sample nearest its pitch (boundaries halfway between roots), so nothing is
    # stretched far up or down. (Some GM organ layouts stretch a sample down 19 semitones.)
    zones_out.sort(key=lambda zz: zz['root'])
    for i, zz in enumerate(zones_out):
        zz['lo'] = 0 if i == 0 else zones_out[i - 1]['hi'] + 1
        zz['hi'] = 127 if i == len(zones_out) - 1 else int(math.floor((zz['root'] + zones_out[i + 1]['root']) / 2))
    out = {'format': 'harmonizer-bank-1', 'id': bid, 'name': title,
           'source': 'GeneralUser GS v2.0.3 by S. Christian Collins (schristiancollins.com) - bank %d program %d "%s", instrument "%s"' % (bank, prog + 1, pname, iname),
           'env': env, 'zones': zones_out}
    path = os.path.join(outdir, 'harmonizer-bank-%s.json' % bid)
    with open(path, 'w') as f: json.dump(out, f, separators=(',', ':'))
    print('%-34s %3d zones  %7.0f KB  keys %d-%d' % (os.path.basename(path), len(zones_out), os.path.getsize(path) / 1024, zones_out[0]['lo'], zones_out[-1]['hi']))
    for zz in zones_out: print('    %3d-%3d root %7.2f  %s  loop %d-%d  gain %.3f' % (zz['lo'], zz['hi'], zz['root'], zz['sample'], zz['loopStart'], zz['loopEnd'], zz['gain']))

if __name__ == '__main__':
    sf = SF2(sys.argv[1]); outdir = sys.argv[2] if len(sys.argv) > 2 else '..'
    for spec in BANKS: build(sf, spec, outdir)
