import { Buffer } from "buffer"

export const base64_arraybuffer = (data_buffer: ArrayBuffer): Promise<string> => {
    const buf = Buffer.from(data_buffer)
    return Promise.resolve(buf.toString("base64"))
}

export const decode_base64_to_Uint8Array = (data: string): Promise<Uint8Array> => {
    const buf = Buffer.from(data, "base64")
    return Promise.resolve(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength / Uint8Array.BYTES_PER_ELEMENT))
}
