declare module "portastic" {
    export function test(port: number, interface?: string, callback?: Function): Promise<boolean>

    export function find(options: { min?: number; max?: number; retrieve?: number }, interface?: string, callback?: Function): Promise<number[]>

    export function filter(ports: number[], interface?: string, callback?: Function): Promise<number[]>

    import { EventEmitter } from "events"
    export class Monitor extends EventEmitter {
        constructor(ports: number[])
        on(event: "open" | "close", listener: (port: number) => void): this
    }
}
