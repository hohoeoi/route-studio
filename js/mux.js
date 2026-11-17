// ---------------------------------------------------------------- MP4 (H.264) writer
// Minimal MP4 muxer for the length-prefixed H.264 chunks WebCodecs gives back.
// One video track, constant frame rate, 'moov' before 'mdat' (fast start), so Premiere opens it as is.
(function (RS) {
  const enc = new TextEncoder();
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function box(type, ...parts) {
    let len = 8;
    const flat = parts.map(p => (p instanceof Uint8Array ? p : new Uint8Array(p)));
    for (const p of flat) len += p.length;
    const out = new Uint8Array(len);
    out.set(u32(len), 0); out.set(enc.encode(type), 4);
    let o = 8;
    for (const p of flat) { out.set(p, o); o += p.length; }
    return out;
  }
  const full = (type, version, flags, ...parts) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

  class Mp4Writer {
    constructor(width, height, fps) {
      this.w = width; this.h = height; this.fps = fps;
      this.timescale = Math.round(fps * 1000); this.delta = 1000;
      this.samples = []; this.sizes = []; this.keys = []; this.total = 0; this.avcC = null;
    }
    add(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.avcC)
        this.avcC = new Uint8Array(meta.decoderConfig.description.buffer ? meta.decoderConfig.description.buffer : meta.decoderConfig.description).slice();
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      this.samples.push(buf); this.sizes.push(buf.length); this.total += buf.length;
      if (chunk.type === "key") this.keys.push(this.samples.length);
    }
    finish() {
      if (!this.avcC) throw new Error("인코더가 H.264 설정 정보를 주지 않았습니다.");
      const n = this.samples.length, dur = n * this.delta, durMovie = Math.round(n * 1000 / this.fps);
      const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(durMovie), u32(0x00010000), u16(0x0100),
        new Array(10).fill(0), MATRIX, new Array(24).fill(0), u32(2));
      const tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMovie), new Array(8).fill(0),
        u16(0), u16(0), u16(0), u16(0), MATRIX, u32(this.w << 16), u32(this.h << 16));
      const mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(this.timescale), u32(dur), u16(0x55c4), u16(0));
      const hdlr = full("hdlr", 0, 0, u32(0), enc.encode("vide"), new Array(12).fill(0), enc.encode("VideoHandler\0"));
      const vmhd = full("vmhd", 0, 1, new Array(8).fill(0));
      const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
      const name = new Array(32).fill(0);
      const avc1 = box("avc1", new Array(6).fill(0), u16(1), u16(0), u16(0), new Array(12).fill(0),
        u16(this.w), u16(this.h), u32(0x00480000), u32(0x00480000), u32(0), u16(1), name, u16(0x0018), u16(0xffff),
        box("avcC", this.avcC),
        // BT.709, limited range: what Chrome's encoder writes and what Premiere assumes for HD
        box("colr", enc.encode("nclx"), u16(1), u16(1), u16(1), [0]));
      const stsd = full("stsd", 0, 0, u32(1), avc1);
      const stts = full("stts", 0, 0, u32(1), u32(n), u32(this.delta));
      const stss = full("stss", 0, 0, u32(this.keys.length), this.keys.flatMap(u32));
      const stsc = full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1));
      const szArr = new Uint8Array(12 + 4 * n);
      const dv = new DataView(szArr.buffer);
      dv.setUint32(4, 0); dv.setUint32(8, n);
      this.sizes.forEach((s, i) => dv.setUint32(12 + 4 * i, s));
      const stsz = box("stsz", szArr);
      const build = off => box("moov", mvhd, box("trak", tkhd, box("mdia", mdhd, hdlr,
        box("minf", vmhd, dinf, box("stbl", stsd, stts, stss, stsc, stsz, full("stco", 0, 0, u32(1), u32(off)))))));
      const ftyp = box("ftyp", enc.encode("isom"), u32(512), enc.encode("isomiso2avc1mp41"));
      const moovLen = build(0).length;
      const moov = build(ftyp.length + moovLen + 8);
      if (this.total + 8 > 0xffffffff) throw new Error("영상이 4GB를 넘습니다. 화질이나 길이를 줄여 주세요.");
      const mdatHead = new Uint8Array([...u32(this.total + 8), ...enc.encode("mdat")]);
      return new Blob([ftyp, moov, mdatHead, ...this.samples], {type: "video/mp4"});
    }
  }
  RS.Mp4Writer = Mp4Writer;
})(RS);
