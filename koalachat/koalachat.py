import logging
import random
import string
from uuid import uuid4


from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)


class Client:
    """a websocket client"""

    def __init__(self, websocket):
        logger.debug("creating new client...")
        self.websocket = websocket
        self.id = str(uuid4())
        self.username = None
        self.chat_id = None

    def set_username(self, username):
        self.username = username

    def set_chat_id(self, chat_id):
        self.chat_id = chat_id

    async def send_json(self, msg):
        logger.info("sending msg to %s: %s", self.id, msg)
        await self.websocket.send_json(msg)

    def __repr__(self):
        return str(self)

    def __str__(self):
        return f"<Client {self.id}>"


class Chat:
    """"""

    pass


class KoalaChat:
    """a simple websocket chat client"""

    def __init__(self):
        self.clients = []
        self.next_id = 0
        self.chat_ids = []

    async def add_client(self, websocket):
        logger.info("add_client")
        client = Client(websocket)
        msg = {
            "type": "id",
            "id": client.id,
        }
        await client.send_json(msg)

        self.clients.append(client)
        return client

    async def remove_client(self, websocket):
        for client in self.clients:
            if client.websocket.client_state == WebSocketState.DISCONNECTED:
                logger.info("removing client...")
                self.clients.remove(client)

        # await self.send_user_list()

    def _get_client(self, msg):
        if msg.get("client_id"):
            for client in self.clients:
                if client.id == msg["client_id"]:
                    logger.info("found client %s", client)
                    return client
        else:
            # username?
            logger.error("no client_id in message")

    def _is_username_unique(self, username):
        for client in self.clients:
            if client.username == username:
                return False
        return True

    def _make_user_list_msg(self):
        msg = {
            "type": "userList",
            "users": [client.username for client in self.clients],
        }
        return msg

    async def send_user_list(self):
        """send the userlist to all clients"""
        msg = self._make_user_list_msg()
        logger.info("send_user_list %s", msg)
        for client in self.clients:
            await client.send_json(msg)

    async def send_to_one_user(self, msg):
        logger.info("send to one user %s", msg["target"])
        target = msg["target"]
        for client in self.clients:
            if client.id == target:
                await client.send_json(msg)
                break

    @staticmethod
    def _create_random_id():
        return "".join([random.choice(string.ascii_uppercase) for _ in range(6)])

    def _create_new_chat_id(self, client):
        chat_id = self._create_random_id()
        while chat_id in self.chat_ids:
            chat_id = self._create_random_id()
        self.chat_ids.append(chat_id)
        logger.info("created new chat_id %s", chat_id)
        return chat_id

    async def _handle_join(self, msg, client):
        logger.info("_handle_join %s...", msg)
        logger.info("number of clients %d", len(self.clients))
        client.set_chat_id(msg["chat_id"])
        for client in self.clients:
            logger.info("client.chat_id %s", client.chat_id)
            if client.chat_id == msg["chat_id"] and client.id != msg["client_id"]:
                try:
                    await client.send_json(msg)
                except RuntimeError as ex:
                    logger.error("websocket is closed?")

    async def handle_message(self, msg):
        logger.info("handle message %s", msg)
        client = self._get_client(msg)
        send_to_clients = True

        msg_type = msg["type"]
        if msg_type == "message":
            msg["name"] = client.username
            # client.set_username(msg['username'])
        elif msg_type == "new":
            send_to_clients = False
            logger.info("create a new url")
            chat_id = self._create_new_chat_id(client)
            msg = {"chat_id": chat_id, "type": "chat_id"}
            client.set_chat_id(chat_id)
            await client.send_json(msg)
        elif msg_type == "username":
            # setting a new username
            name_changed = False
            while not self._is_username_unique(msg["name"]):
                msg["name"] += "0"
                name_changed = True
            if name_changed:
                msg = {
                    "id": msg["id"],
                    "type": "rejectusername",
                    "name": msg["name"],
                }
                await client.send_json(msg)
            client.set_username(msg["name"])
            await self.send_user_list()
            send_to_clients = False
        elif msg_type == "join":
            await self._handle_join(msg, client)
            return

        if send_to_clients:
            if msg.get("target"):
                await self.send_to_one_user(msg)
            else:
                for client in self.clients:
                    await client.send_json(msg)
