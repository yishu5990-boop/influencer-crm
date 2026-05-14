// HTTP CONNECT 代理隧道 — 用于在国内通过 Clash/V2Ray 访问 Gmail IMAP
import net from 'net'

const PROXY_HOST = process.env.HTTP_PROXY_HOST || '127.0.0.1'
const PROXY_PORT = parseInt(process.env.HTTP_PROXY_PORT || '7890', 10)

// 通过 HTTP CONNECT 建立到目标主机的隧道
function createTunnel(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PROXY_HOST, port: PROXY_PORT })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('代理连接超时，请确认 VPN/代理已开启'))
    }, 10000)

    socket.on('connect', () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`)
    })

    socket.once('data', (data) => {
      clearTimeout(timer)
      const line = data.toString().split('\r\n')[0] || ''
      if (line.includes('200')) {
        resolve(socket)
      } else {
        socket.destroy()
        reject(new Error(`代理隧道建立失败: ${line}`))
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`无法连接代理 ${PROXY_HOST}:${PROXY_PORT}: ${err.message}`))
    })
  })
}

// 启动本地转发服务器，返回本地端口号
export function startForwardServer(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const localPort = server.address().port
      resolve({ server, localPort })
    })

    server.on('error', reject)

    server.on('connection', (clientSocket) => {
      createTunnel(targetHost, targetPort)
        .then((proxySocket) => {
          clientSocket.pipe(proxySocket)
          proxySocket.pipe(clientSocket)
          proxySocket.on('error', () => clientSocket.destroy())
          clientSocket.on('error', () => proxySocket.destroy())
        })
        .catch(() => clientSocket.destroy())
    })
  })
}
