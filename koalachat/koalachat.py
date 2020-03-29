import logging
from uuid import uuid4


from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)

class Client():
    """a websocket client"""
    def __init__(self, websocket):
        logger.debug('creating new client...')
        self.websocket = websocket
        self.id = str(uuid4())
        self.username = None

    def set_username(self, username):
        self.username = username


    async def send_json(self, msg):
        logger.info('sending msg to %s: %s', self.id, msg)
        await self.websocket.send_json(msg)

    def __repr__(self):
        return str(self)

    def __str__(self):
        return f'<Client {self.id}>'

class KoalaChat():
    """a simple websocket chat client"""
    def __init__(self):
        self.clients = []
        self.next_id = 0

    async def add_client(self, websocket):
        logger.info('add_client')
        client = Client(websocket)
        msg = {
            'type': 'id',
            'id': client.id,
        }
        await websocket.send_json(msg)

        self.clients.append(client)
        return client

    async def remove_client(self, websocket):
        for client in self.clients:
            if client.websocket.client_state == WebSocketState.DISCONNECTED:

                logger.info('removing client')
                self.clients.remove(client)

        await self.send_user_list()     

    def _get_client(self, msg):
        if msg.get('id'):
            for client in self.clients:
                if client.id == msg['id']:
                    logger.info('found client %s', client)
                    return client
        else:
            # username?
            logger.error('no id in message')

    def _is_username_unique(self, username):
        for client in self.clients:
            if client.username == username:
                return False
        return True

    def _make_user_list_msg(self):
        msg = {
                'type':'userList',
            'users': [client.username for client in self.clients]
,
        }
        return msg

    async def send_user_list(self):
        """send the userlist to all clients"""
        msg = self._make_user_list_msg()
        logger.info('send_user_list %s', msg)
        for client in self.clients:
            await client.send_json(msg)

    async def send_to_one_user(self, msg):
        target = msg['target']
        for client in self.clients:
            if client.username == target:
                await client.send_json(msg)
                break

    async def handle_message(self, msg):
        logger.info('handle message %s', msg)
        client = self._get_client(msg)
        send_to_clients = True

        msg_type = msg['type']
        if msg_type == 'message':
            msg['name'] = client.username
            #client.set_username(msg['username'])
        elif msg_type == 'username':
            #setting a new username
            name_changed = False
            while not self._is_username_unique(msg['name']):
                msg['name'] += '0'
                name_changed = True
            if name_changed:
                msg = {
                    'id': msg['id'],
                    'type': 'rejectusername',
                    'name': msg['name'],
                }
                await client.send_json(msg)
            client.set_username(msg['name'])
            await self.send_user_list()
            send_to_clients = False

        if send_to_clients:
            if msg.get('target'):
                await self.send_to_one_user(msg)
            else:
                for client in self.clients:
                    await client.send_json(msg)


