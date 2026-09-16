import { createHash, randomBytes } from "node:crypto";

export function generateAcceptKey(key) {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

export function encodeFrame(payload, options = {}) {
  const { opcode = 0x1, masked = false } = options;
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "");
  const length = buf.length;
  
  let headerLength = 2;
  if (length >= 126 && length <= 65535) headerLength += 2;
  else if (length > 65535) headerLength += 8;
  if (masked) headerLength += 4;
  
  const frame = Buffer.allocUnsafe(headerLength + length);
  frame[0] = 0x80 | (opcode & 0x0f); // fin = 1, rsv = 0
  
  let offset = 2;
  if (length < 126) {
    frame[1] = length | (masked ? 0x80 : 0);
  } else if (length <= 65535) {
    frame[1] = 126 | (masked ? 0x80 : 0);
    frame.writeUInt16BE(length, 2);
    offset += 2;
  } else {
    frame[1] = 127 | (masked ? 0x80 : 0);
    frame.writeBigUInt64BE(BigInt(length), 2);
    offset += 8;
  }
  
  if (masked) {
    const mask = randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < length; i++) {
      frame[offset + i] = buf[i] ^ mask[i % 4];
    }
  } else {
    buf.copy(frame, offset);
  }
  
  return frame;
}

// Stateful decoder for streaming data
export class FrameDecoder {
  constructor(onFrame) {
    this.buffer = Buffer.alloc(0);
    this.onFrame = onFrame;
  }
  
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.process()) {}
  }
  
  process() {
    if (this.buffer.length < 2) return false;
    
    const byte0 = this.buffer[0];
    const byte1 = this.buffer[1];
    
    const fin = (byte0 & 0x80) !== 0;
    const opcode = byte0 & 0x0f;
    const isMasked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;
    
    let offset = 2;
    if (payloadLen === 126) {
      if (this.buffer.length < offset + 2) return false;
      payloadLen = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (this.buffer.length < offset + 8) return false;
      const lenBig = this.buffer.readBigUInt64BE(offset);
      if (lenBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Payload too large");
      payloadLen = Number(lenBig);
      offset += 8;
    }
    
    if (isMasked) {
      if (this.buffer.length < offset + 4) return false;
      offset += 4;
    }
    
    if (this.buffer.length < offset + payloadLen) return false;
    
    let payload = this.buffer.subarray(offset, offset + payloadLen);
    
    if (isMasked) {
      const mask = this.buffer.subarray(offset - 4, offset);
      const unmasked = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    } else {
      payload = Buffer.from(payload); // copy so we can slice this.buffer
    }
    
    this.buffer = this.buffer.subarray(offset + payloadLen);
    
    if (!fin && opcode !== 0x0) {
      this.onFrame({ opcode: 0x8, payload: Buffer.from("fragmentation unsupported") }, true);
      return false; // stop processing
    }
    
    // Only allow 0x1, 0x8, 0x9, 0xA.
    if (![0x1, 0x8, 0x9, 0xa].includes(opcode)) {
       this.onFrame({ opcode: 0x8, payload: Buffer.from("unsupported opcode") }, true);
       return false;
    }
    
    this.onFrame({ opcode, payload });
    return true;
  }
}
