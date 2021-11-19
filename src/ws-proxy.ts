import { create_pluto_connection } from "./julia-ws-connection"
import { base64_arraybuffer, decode_base64_to_Uint8Array } from "./encoding"
const DEBUG = false

/** Set up a proxy between the Pluto server and a new Webview. This will open a WebSocket connection with the Pluto server, and open an official-VS-Code-API-connection with the webview frontend.
 *
 * See the bottom of our `README.md` for more information about this proxy. */
export const create_proxy = ({
    ws_address,
    send_to_client,
    create_client_listener,
    alert,
    confirm,
}: {
    /** Address of the WebSocket server hosted by Pluto in this process. */
    ws_address: string
    /** Let me send messages to the Webview frontend using VS Code API please. */
    send_to_client: any
    /** Let me listen to messages from the Webview frontend using VS Code API please. */
    create_client_listener: any
    /** Function to call if the frontend wants to trigger a `window.alert`. */
    alert: any
    /** Function to call if the frontend wants to trigger a `window.confirm`. */
    confirm: any
}) => {
    return new Promise<void>((resolve) => {
        const on_unrequested_update = async (update: Uint8Array) => {
            const to_send = { type: "ws_proxy", base64_encoded: await base64_arraybuffer(update) }
            DEBUG && console.info("PROXY message from JULIA", to_send)
            await send_to_client(to_send)
        }
        const on_reconnect = () => {
            return true
        }
        const on_connection_status = (connection_status: boolean) => {
            ///
            if (connection_status) {
                console.log("Proxy connected!")
                resolve()
            }
        }
        create_pluto_connection({
            on_unrequested_update,
            on_connection_status,
            on_reconnect,
            ws_address,
        }).then((connection) => {
            create_client_listener(async (message: { type: string; base64_encoded: string; text: string; token: string }) => {
                if (message.type === "ws_proxy") {
                    DEBUG && console.info("PROXY message from CLIENT", message)
                    const data = await decode_base64_to_Uint8Array(message.base64_encoded)
                    connection.send(data)
                } else if (message.type === "alert") {
                    alert(message.text).then(() => {
                        send_to_client({ type: "alert_confirm_callback", token: message.token })
                    })
                } else if (message.type === "confirm") {
                    confirm(message.text).then((value: boolean) => {
                        send_to_client({ type: "alert_confirm_callback", token: message.token, value })
                    })
                }
            })
        })
    })
}
