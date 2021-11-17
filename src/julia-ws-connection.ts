/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-empty-function */

/*
This file is from Pluto's source code, with small changes to convert it from JS to TS, and to run it in Node.

Original: https://github.com/fonsp/Pluto.jl/blob/v0.16.4/frontend/common/PlutoConnection.js

It sets up and maintains a WS connection with the Pluto server. 

YOU SHOULD NOT have to make changes to this, unless you are a Pluto dev and you have worked with our WebSocket stuff before.

*/

import WebSocket from "ws"
import * as vscode from "vscode"

const alert = vscode.window.showErrorMessage

const reconnect_after_close_delay = 500
const retry_after_connect_failure_delay = 5000

const pack = (x: any) => x
const unpack = (x: any) => x

const Promises_delay = (delay: number) => new Promise((r) => setTimeout(r, delay))

/**
 * Return a promise that resolves to:
 *  - the resolved value of `promise`
 *  - an error after `time_ms` milliseconds
 * whichever comes first.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} time_ms
 * @returns {Promise<T>}
 */
export const timeout_promise = (promise: Promise<any>, time_ms: number): Promise<any> =>
    Promise.race([
        promise,
        new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new Error("Promise timed out."))
            }, time_ms)
        }),
    ])

/**
 * Keep calling @see f until it resolves, with a delay before each try.
 * @param {Function} f Function that returns a promise
 * @param {Number} time_ms Timeout for each call to @see f
 */
const retry_until_resolved = (f: Function, time_ms: number): Promise<any> =>
    timeout_promise(f(), time_ms).catch((e) => {
        console.error(e)
        console.error("try failed... trying again")
        return retry_until_resolved(f, time_ms)
    })

export const resolvable_promise = <T>(): {
    current: Promise<T>
    resolve: (value: T) => void
    reject: (error: any) => void
} => {
    let resolve = (x: T) => {}
    let reject = (x: T) => {}
    const p = new Promise<T>((_resolve, _reject) => {
        resolve = _resolve
        reject = _reject
    })
    return {
        current: p,
        resolve: resolve,
        reject: reject,
    }
}

const socket_is_alright = (socket: WebSocket) => socket.readyState == WebSocket.OPEN || socket.readyState == WebSocket.CONNECTING

const socket_is_alright_with_grace_period = (socket: WebSocket) =>
    new Promise((res) => {
        if (socket_is_alright(socket)) {
            res(true)
        } else {
            setTimeout(() => {
                res(socket_is_alright(socket))
            }, 1000)
        }
    })

const try_close_socket_connection = (socket: WebSocket) => {
    socket.onopen = () => {
        try_close_socket_connection(socket)
    }
    socket.onmessage = (e) => {}
    socket.onclose = (e) => {}
    socket.onerror = (e) => {}
    try {
        socket.close(1000, "byebye")
    } catch (ex) {
        //
    }
}

type WebsocketConnection = { socket: WebSocket; send: Function }

/**
 * Open a 'raw' websocket connection to an API with MessagePack serialization. The method is asynchonous, and resolves to a @see WebsocketConnection when the connection is established.
 */
const create_ws_connection = (
    address: string,
    { on_message, on_socket_close }: { on_message: Function; on_socket_close: Function },
    timeout_s = 30
): Promise<WebsocketConnection> => {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(address)
        socket.binaryType = "arraybuffer"

        let has_been_open = false

        const timeout_handle = setTimeout(() => {
            console.warn("Creating websocket timed out", new Date().toLocaleTimeString())
            try_close_socket_connection(socket)
            reject("Socket timeout")
        }, timeout_s * 1000)

        const send_encoded = (message: Uint8Array) => {
            const encoded = pack(message)
            socket.send(encoded)
        }

        let last_task = Promise.resolve()
        socket.onmessage = (event) => {
            // we read and deserialize the incoming messages asynchronously
            // they arrive in order (WS guarantees this), i.e. this socket.onmessage event gets fired with the message events in the right order
            // but some message are read and deserialized much faster than others, because of varying sizes, so _after_ async read & deserialization, messages are no longer guaranteed to be in order
            //
            // the solution is a task queue, where each task includes the deserialization and the update handler
            last_task = last_task.then(async () => {
                try {
                    const buffer = event.data as ArrayBuffer
                    const message = unpack(new Uint8Array(buffer))

                    try {
                        on_message(message)
                    } catch (process_err) {
                        console.error("Failed to process message from websocket", process_err, {
                            message,
                        })
                        // prettier-ignore
                        alert(`Something went wrong! You might need to refresh the page.\n\nPlease open an issue on https://github.com/fonsp/Pluto.jl with this info:\n\nFailed to process update\n${process_err}\n\n${JSON.stringify(event)}`);
                    }
                } catch (unpack_err) {
                    console.error("Failed to unpack message from websocket", unpack_err, { event })

                    // prettier-ignore
                    alert(`Something went wrong! You might need to refresh the page.\n\nPlease open an issue on https://github.com/fonsp/Pluto.jl with this info:\n\nFailed to unpack message\n${unpack_err}\n\n${JSON.stringify(event)}`);
                }
            })
        }

        socket.onerror = async (e) => {
            console.error(`Socket did an oopsie - ${e.type}`, new Date().toLocaleTimeString(), "was open:", has_been_open, e)

            if (await socket_is_alright_with_grace_period(socket)) {
                console.log("The socket somehow recovered from an error?! Onbegrijpelijk")
                console.log(socket)
                console.log(socket.readyState)
            } else {
                if (has_been_open) {
                    on_socket_close()
                    try_close_socket_connection(socket)
                } else {
                    reject(e)
                }
            }
        }
        socket.onclose = async (e) => {
            console.error(`Socket did an oopsie - ${e.type}`, new Date().toLocaleTimeString(), "was open:", has_been_open, e)

            if (has_been_open) {
                on_socket_close()
                try_close_socket_connection(socket)
            } else {
                reject(e)
            }
        }
        socket.onopen = () => {
            console.log("Socket opened", new Date().toLocaleTimeString())
            clearInterval(timeout_handle)
            has_been_open = true
            resolve({
                socket: socket,
                send: send_encoded,
            })
        }
        console.log("Waiting for socket to open...", new Date().toLocaleTimeString())
    })
}

type PlutoConnection = {
    session_options: any
    send: (data: Uint8Array) => void
    kill: () => void
    version_info: {
        julia: string
        pluto: string
        dismiss_update_notification: boolean
    }
}

type PlutoMessage = Uint8Array

/**
 * Open a connection with Pluto, that supports a question-response mechanism. The method is asynchonous, and resolves to a @see PlutoConnection when the connection is established.
 *
 * The server can also send messages to all clients, without being requested by them. These end up in the @see on_unrequested_update callback.
 */
export const create_pluto_connection = async ({
    on_unrequested_update,
    on_reconnect,
    on_connection_status,
    ws_address = "",
}: {
    on_unrequested_update: (message: PlutoMessage) => void
    on_reconnect: () => boolean
    on_connection_status: (connection_status: boolean) => void
    ws_address?: string
}): Promise<PlutoConnection> => {
    // will be defined later i promise
    let ws_connection: WebsocketConnection | null = null
    const client: PlutoConnection = {
        send: () => {},
        kill: () => {},
        session_options: null,
        version_info: {
            julia: "unknown",
            pluto: "unknown",
            dismiss_update_notification: false,
        },
    } // same

    const send = (x: Uint8Array) => ws_connection?.send(x)
    client.send = send

    const connect = async () => {
        try {
            ws_connection = await create_ws_connection(String(ws_address), {
                on_message: on_unrequested_update,
                on_socket_close: async () => {
                    on_connection_status(false)

                    console.log(`Starting new websocket`, new Date().toLocaleTimeString())
                    await Promises_delay(reconnect_after_close_delay)
                    await connect() // reconnect!

                    console.log(`Starting state sync`, new Date().toLocaleTimeString())
                    const accept = on_reconnect()
                    console.log(`State sync ${accept ? "" : "not "}successful`, new Date().toLocaleTimeString())
                    on_connection_status(accept)
                    if (!accept) {
                        alert("Connection out of sync 😥\n\nRefresh the page to continue")
                    }
                },
            })

            on_connection_status(true)

            // const ping = () => {
            // 	send('ping')
            // 		.then(() => {
            // 			// Ping faster than timeout?
            // 			setTimeout(ping, 28 * 1000);
            // 		})
            // 		.catch();
            // };
            // ping();

            return
        } catch (ex) {
            console.error("connect() failed", ex)
            await Promises_delay(retry_after_connect_failure_delay)
            await connect()
            return
        }
    }
    await connect()

    return client
}
