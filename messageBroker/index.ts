import Aedes from 'aedes';
import net from 'net';

const broker = new Aedes();
const server = net.createServer(broker.handle);
const port = 1883;

server.listen(port, function () {
  console.log(`Aedes broker started on port: ${port}`);
});

broker.on('client', function (client) {
  console.log('Client Connected:', client.id);
});

broker.on('publish', function (packet, client) {
  if (client !== null) {
    // Add this null check
    console.log('Published:', packet.payload.toString());
  }
});
