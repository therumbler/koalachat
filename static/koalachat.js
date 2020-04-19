(function () {
    var clientID;
    var connection;
    var chatId;
    var peerConnection;
    var targetClientID;
    var webcamStream;
    console.log('in koalachat.js');
    // Create the RTCPeerConnection which knows how to talk to our
    // selected STUN/TURN server and then uses getUserMedia() to find
    // our camera and microphone and add that stream to the connection for
    // use in our video call. Then we configure event handlers to get
    // needed notifications on the call.
    // Accept an offer to video chat. We configure our local settings,
    // create our RTCPeerConnection, get and attach our local camera
    // stream, then create and send an answer to the caller.

    async function handleVideoOfferMsg(msg) {
        targetClientID = msg.client_id;

        // If we're not already connected, create an RTCPeerConnection
        // to be linked to the caller.

        console.log("Received video chat offer from " + targetClientID);
        if (!peerConnection) {
            createPeerConnection();
        }

        // We need to set the remote description to the received SDP offer
        // so that our local WebRTC layer knows how to talk to the caller.

        var desc = new RTCSessionDescription(msg.sdp);

        // If the connection isn't stable yet, wait for it...

        if (peerConnection.signalingState != "stable") {
            console.log("  - But the signaling state isn't stable, so triggering rollback");

            // Set the local and remove descriptions for rollback; don't proceed
            // until both return.
            await Promise.all([
                peerConnection.setLocalDescription({ type: "rollback" }),
                peerConnection.setRemoteDescription(desc)
            ]);
            return;
        } else {
            console.log("  - Setting remote description");
            await peerConnection.setRemoteDescription(desc);
        }

        // Get the webcam stream if we don't already have it

        if (!webcamStream) {
            try {
                webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
            } catch (err) {
                handleGetUserMediaError(err);
                return;
            }

            document.getElementById("local_video").srcObject = webcamStream;

            // Add the camera stream to the RTCPeerConnection

            try {
                webcamStream.getTracks().forEach(
                    transceiver = track => peerConnection.addTransceiver(track, { streams: [webcamStream] })
                );
            } catch (err) {
                handleGetUserMediaError(err);
            }
        }

        console.log("---> Creating and sending answer to caller");

        await peerConnection.setLocalDescription(await peerConnection.createAnswer());

        sendToServer({
            name: clientID,
            target: targetClientID,
            type: "video-answer",
            sdp: peerConnection.localDescription
        });
    }
    async function createPeerConnection() {
        console.log("Setting up a connection...");

        // Create an RTCPeerConnection which knows to use our chosen
        // STUN server.

        peerConnection = new RTCPeerConnection({
            iceServers: [     // Information about ICE servers - Use your own!
                { "urls": "turn:numb.viagenie.ca", "username": "webrtc@live.com", "credential": "muazkh" }
            ]
        });

        // Set up event handlers for the ICE negotiation process.

        peerConnection.onicecandidate = handleICECandidateEvent;
        peerConnection.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
        peerConnection.onicegatheringstatechange = handleICEGatheringStateChangeEvent;
        peerConnection.onsignalingstatechange = handleSignalingStateChangeEvent;
        peerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
        peerConnection.ontrack = handleTrackEvent;
        peerConnection.onaddstream = handleRemoteStreamEvent;
    }

    // Called by the WebRTC layer to let us know when it's time to
    // begin, resume, or restart ICE negotiation.

    async function handleNegotiationNeededEvent() {
        console.log("*** Negotiation needed");

        try {
            console.log("---> Creating offer");
            const offer = await peerConnection.createOffer();

            // If the connection hasn't yet achieved the "stable" state,
            // return to the caller. Another negotiationneeded event
            // will be fired when the state stabilizes.

            if (peerConnection.signalingState != "stable") {
                console.log("     -- The connection isn't stable yet; postponing...")
                return;
            }

            // Establish the offer as the local peer's current
            // description.

            console.log("---> Setting local description to the offer");
            await peerConnection.setLocalDescription(offer);

            // Send the offer to the remote peer.

            console.log("---> Sending the offer to the remote peer");
            sendToServer({
                name: clientID,
                targetClientID: targetClientID,
                type: "video-offer",
                sdp: peerConnection.localDescription
            });
        } catch (err) {
            console.log("*** The following error occurred while handling the negotiationneeded event:");
            reportError(err);
        };
    }

    // Responds to the "video-answer" message sent to the caller
    // once the callee has decided to accept our request to talk.

    async function handleVideoAnswerMsg(msg) {
        console.log("*** Call recipient has accepted our call");

        // Configure the remote description, which is the SDP payload
        // in our "video-answer" message.

        var desc = new RTCSessionDescription(msg.sdp);
        await peerConnection.setRemoteDescription(desc).catch(reportError);
    }

    // A new ICE candidate has been received from the other peer. Call
    // RTCPeerConnection.addIceCandidate() to send it along to the
    // local ICE framework.

    async function handleNewICECandidateMsg(msg) {
        var candidate = new RTCIceCandidate(msg.candidate);

        console.log("*** Adding received ICE candidate: " + JSON.stringify(candidate));
        try {
            await peerConnection.addIceCandidate(candidate)
        } catch (err) {
            reportError(err);
        }
    }

    // Called by the WebRTC layer when events occur on the media tracks
    // on our WebRTC call. This includes when streams are added to and
    // removed from the call.
    //
    // track events include the following fields:
    //
    // RTCRtpReceiver       receiver
    // MediaStreamTrack     track
    // MediaStream[]        streams
    // RTCRtpTransceiver    transceiver
    //
    // In our case, we're just taking the first stream found and attaching
    // it to the <video> element for incoming media.

    function handleTrackEvent(event) {
        console.log("*** Track event");
        console.log(event);
        var videoElement = document.getElementById("received_video");
        videoElement.srcObject = event.streams[0];
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.muted = true;
        document.getElementById("hangup-button").disabled = false;
    }
    function handleRemoteStreamEvent(event) {
        console.log("*** Remote Stream event");
        console.log(event);
        var videoElement = document.getElementById("received_video");
        videoElement.srcObject = event.stream;
        videoElement.autoplay = true;

    }

    // Handles |icecandidate| events by forwarding the specified
    // ICE candidate (created by our local ICE agent) to the other
    // peer through the signaling server.

    function handleICECandidateEvent(event) {
        if (event.candidate) {
            console.log("*** Outgoing ICE candidate: " + event.candidate.candidate);

            sendToServer({
                type: "new-ice-candidate",
                target: targetClientID,
                candidate: event.candidate
            });
        }
    }

    // Handle |iceconnectionstatechange| events. This will detect
    // when the ICE connection is closed, failed, or disconnected.
    //
    // This is called when the state of the ICE agent changes.

    function handleICEConnectionStateChangeEvent(event) {
        console.log("*** ICE connection state changed to " + peerConnection.iceConnectionState);

        switch (peerConnection.iceConnectionState) {
            case "closed":
            case "failed":
            case "disconnected":
                closeVideoCall();
                break;
        }
    }

    // Set up a |signalingstatechange| event handler. This will detect when
    // the signaling connection is closed.
    //
    // NOTE: This will actually move to the new RTCPeerConnectionState enum
    // returned in the property RTCPeerConnection.connectionState when
    // browsers catch up with the latest version of the specification!

    function handleSignalingStateChangeEvent(event) {
        console.log("*** WebRTC signaling state changed to: " + peerConnection.signalingState);
        switch (peerConnection.signalingState) {
            case "closed":
                closeVideoCall();
                break;
        }
    }

    // Handle the |icegatheringstatechange| event. This lets us know what the
    // ICE engine is currently working on: "new" means no networking has happened
    // yet, "gathering" means the ICE engine is currently gathering candidates,
    // and "complete" means gathering is complete. Note that the engine can
    // alternate between "gathering" and "complete" repeatedly as needs and
    // circumstances change.
    //
    // We don't need to do anything when this happens, but we log it to the
    // console so you can see what's going on when playing with the sample.

    function handleICEGatheringStateChangeEvent(event) {
        console.log("*** ICE gathering state changed to: " + peerConnection.iceGatheringState);
    }

    // Given a message containing a list of usernames, this function
    // populates the user list box with those names, making each item
    // clickable to allow starting a video call.

    function handleUserlistMsg(msg) {
        var i;
        var listElem = document.querySelector(".userlistbox");

        // Remove all current list members. We could do this smarter,
        // by adding and updating users instead of rebuilding from
        // scratch but this will do for this sample.

        while (listElem.firstChild) {
            listElem.removeChild(listElem.firstChild);
        }

        // Add member names from the received list.

        msg.users.forEach(function (username) {
            var item = document.createElement("li");
            item.appendChild(document.createTextNode(username));
            item.addEventListener("click", invite, false);

            listElem.appendChild(item);
        });
    }

    // Close the RTCPeerConnection and reset variables so that the user can
    // make or receive another call if they wish. This is called both
    // when the user hangs up, the other user hangs up, or if a connection
    // failure is detected.

    function closeVideoCall() {
        var localVideo = document.getElementById("local_video");

        console.log("Closing the call");

        // Close the RTCPeerConnection

        if (peerConnection) {
            console.log("--> Closing the peer connection");

            // Disconnect all our event listeners; we don't want stray events
            // to interfere with the hangup while it's ongoing.

            peerConnection.ontrack = null;
            peerConnection.onnicecandidate = null;
            peerConnection.oniceconnectionstatechange = null;
            peerConnection.onsignalingstatechange = null;
            peerConnection.onicegatheringstatechange = null;
            peerConnection.onnotificationneeded = null;

            // Stop all transceivers on the connection

            peerConnection.getTransceivers().forEach(transceiver => {
                console.log('** stopping transceiver...')
                console.log(transceiver);
                try {
                    transceiver.stop();
                } catch (err) {
                    reportError(err);
                }
            });

            // Stop the webcam preview as well by pausing the <video>
            // element, then stopping each of the getUserMedia() tracks
            // on it.

            if (localVideo.srcObject) {
                localVideo.pause();
                localVideo.srcObject.getTracks().forEach(track => {
                    console.log('stopping the track object')
                    track.stop();
                });
            }

            // Close the peer connection

            peerConnection.close();
            peerConnection = null;
            webcamStream = null;
        }

        // Disable the hangup button

        document.getElementById("hangup-button").disabled = true;
        targetClientID = null;
    }
    function sendToServer(msg) {
        if (!msg.hasOwnProperty("client_id")) {
            msg.client_id = clientID
        }
        var msgJSON = JSON.stringify(msg);

        console.log("Sending '" + msg.type + "' message: " + msgJSON);
        connection.send(msgJSON);
    }
    var mediaConstraints = {
        audio: true,            // We want an audio track
        video: {
            aspectRatio: {
                ideal: 1.333333     // 3:2 aspect is preferred
            }
        }
    };
    function handleGetUserMediaError(e) {
        console.error(e);
        switch (e.name) {
            case "NotFoundError":
                alert("Unable to open your call because no camera and/or microphone" +
                    "were found.");
                break;
            case "SecurityError":
            case "PermissionDeniedError":
                // Do nothing; this is the same as the user canceling the call.
                break;
            default:
                alert("Error opening your camera and/or microphone: " + e.message);
                break;
        }

        // Make sure we shut down our end of the RTCPeerConnection so we're
        // ready to try again.

        closeVideoCall();
    }
    var setupLocalVideo = async function () {
        console.log('setupLocalVideo')
        try {
            var webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
            document.getElementById("local_video").srcObject = webcamStream;
        } catch (err) {
            handleGetUserMediaError(err);
            return;
        }
    }

    var getWebSocketAddress = function () {
        var hostname = window.location.hostname;
        if (!hostname) {
            hostname = "localhost";
        }
        console.log("Hostname: " + hostname);
        var scheme = document.location.protocol === "https:" ? 'wss' : 'ws';
        var port = document.location.port;
        console.log('scheme', scheme, 'port', port);
        var webSocketAddress = scheme + '://' + hostname;
        if (port) {
            webSocketAddress = webSocketAddress + ':' + port;
        } else {
            webSocketAddress = webSocketAddress + '/koalachat';
        }
        webSocketAddress = webSocketAddress + '/ws/';
        console.log('webSocketAddress', webSocketAddress)
        return webSocketAddress;
    }
    var setupWebSocket = function () {
        var webSocketAddress = getWebSocketAddress();
        connection = new WebSocket(webSocketAddress);
        connection.onopen = function (evt) {
            console.log('ws connection opened')
        };
        connection.onerror = function (evt) {
            console.dir(evt);
        }
        connection.onmessage = async function (evt) {
            var chatBox = document.querySelector(".chatbox");
            var text = "";
            var msg = JSON.parse(evt.data);
            console.log("Message received: ");
            console.dir(msg);
            var time = new Date(msg.date);
            var timeStr = time.toLocaleTimeString();

            switch (msg.type) {
                case "id":
                    clientID = msg.id;
                    if (chatId) {
                        console.log('chatId', chatId);
                        var msg = {
                            type: 'join',
                            chat_id: chatId
                        }
                        sendToServer(msg);
                    }
                    break;

                case "message":
                    text = "(" + timeStr + ") <b>" + msg.name + "</b>: " + msg.text + "<br>";
                    break;

                case "chat_id":
                    window.history.pushState("", "", "?chat_id=" + msg.chat_id);

                // Signaling messages: these messages are used to trade WebRTC
                // signaling information during negotiations leading up to a video
                // call.

                case "video-offer":  // Invitation and offer to chat
                    handleVideoOfferMsg(msg);
                    break;

                case "video-answer":  // Callee has answered our offer
                    handleVideoAnswerMsg(msg);
                    break;

                case "new-ice-candidate": // A new ICE candidate has been received
                    handleNewICECandidateMsg(msg);
                    break;

                case "hang-up": // The other peer has hung up the call
                    handleHangUpMsg(msg);
                    break;

                case "join":
                    await initiateChat(msg);
                    break;
                // Unknown message; output to console for debugging.

                default:
                    console.error("Unknown message received:");
                    console.error(msg);
            }

            // If there's text to insert into the chat buffer, do so now, then
            // scroll the chat panel so that the new text is visible.

            if (text.length) {
                chatBox.innerHTML += text;
                chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
            }
        };
    }
    var initiateChat = async function (msg) {
        console.log('initiateChat');
        if (msg.client_id == clientID) {
            console.error('we sent this message. ignoring it');
            return;
        }
        console.log("Starting to prepare an invitation");
        if (peerConnection) {
            console.error("You can't start a call because you already have one open!");
            return;
        }
        targetClientID = msg.client_id;

        // Don't allow users to call themselves, because weird.

        if (targetClientID === clientID) {
            alert("I'm afraid I can't let you talk to yourself. That would be weird.");
            return;
        }

        // Record the username being called for future reference

        console.log("Inviting user " + targetClientID);

        // Call createPeerConnection() to create the RTCPeerConnection.
        // When this returns, peerConnection is our RTCPeerConnection
        // and webcamStream is a stream coming from the camera. They are
        // not linked together in any way yet.

        console.log("Setting up connection to invite user: " + targetClientID);
        createPeerConnection();

        // Get access to the webcam stream and attach it to the
        // "preview" box (id "local_video").

        try {
            webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
            document.getElementById("local_video").srcObject = webcamStream;
        } catch (err) {
            handleGetUserMediaError(err);
            return;
        }


        // peerConnection.addStream(webcamStream);

        // Add the tracks from the stream to the RTCPeerConnection

        try {
            webcamStream.getTracks().forEach(function (track) {
                console.log('*** adding track via addTransceiver...')
                console.log(track);
                transceiver = peerConnection.addTransceiver(track, { streams: [webcamStream] })

            });
        } catch (err) {
            handleGetUserMediaError(err);
        }
    }
    var init = async function () {
        await setupLocalVideo();
        setupWebSocket();
        var urlParams = new URLSearchParams(window.location.search);
        chatId = urlParams.get('chat_id');

        document.querySelector('#new').addEventListener('click', function (evt) {
            console.log('new');
            var msg = {
                type: "new",
                date: Date.now()
            };
            sendToServer(msg);
        });
    }

    function ready(fn) {
        if (document.readyState != 'loading') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }
    ready(init);
    function reportError(errMessage) {
        var loggedMsg = `Error ${errMessage.name}: ${errMessage.message}`;
        console.error(loggedMsg);
        var msg = {
            type: 'error',
            message: loggedMsg
        }
        sendToServer(msg);
    }
})();