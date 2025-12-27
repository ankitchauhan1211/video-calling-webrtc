"use client";
import { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import styles from "../styles/FirstPage.module.css";


const socket = io("https://signaling-server-zyb9.onrender.com");

const FirstPage = () => {
  const [username, setUsername] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [callTo, setCallTo] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const ringtoneRef = useRef(null);
  const ringtoneRef2 =useRef(null);

  const [localStream, setLocalStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);

  const [isAudio, setIsAudio] = useState(true);
  const [isVideo, setIsVideo] = useState(true);
  const [inCall, setInCall] = useState(false);

  // Register
  const handleRegister = (e) => {
    e.preventDefault();
    if (!username) return alert("Enter username!");
    socket.emit("register", username);
    setCurrentUser(username);
    alert(`✅ Registered as ${username}`);
  };

  // Call user
  const handleCall = (e) => {
    e.preventDefault();
    ringtoneRef2.current.play();
    if (!callTo) return alert("Enter username to call!");
    socket.emit("callUser", { from: currentUser, to: callTo });
    setInCall(true); // outgoing ringtone
    alert(`📞 Calling ${callTo}...`);
  };

  // Hang Up
  const handleHangUp = () => {
    if (peerConnection) {
      peerConnection.close();
      setPeerConnection(null);
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    if (inCall) {
      socket.emit("hangUp", { from: currentUser, to: callTo });
    }
    setInCall(false);
    ringtoneRef2.current.pause();
    ringtoneRef.current.pause();
    ringtoneRef.current.currentTime = 0;
    alert("📴 Call Ended");
  };

  // Init local media
  async function initLocalStream() {
    if (!localStream) {
      const stream = await navigator?.mediaDevices?.getUserMedia({
        video: true,
        audio: true,
      });
      localVideoRef.current.srcObject = stream;
      setLocalStream(stream);
      return stream;
    }
    return localStream;
  }

  // PeerConnection
  function createPeerConnection(otherUser) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("iceCandidate", {
          to: otherUser,
          from: currentUser,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      remoteVideoRef.current.srcObject = event.streams[0];
    };

    setPeerConnection(pc);
    return pc;
  }

  // Start call
  async function startCall(otherUser, isReceiver) {
    const stream = await initLocalStream(); // fix for null
    const pc = createPeerConnection(otherUser);
    stream?.getTracks().forEach((track) => pc.addTrack(track, stream));

    if (!isReceiver) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { to: otherUser, from: currentUser, offer });
    }

    setInCall(true);
    ringtoneRef.current.pause();
    ringtoneRef.current.currentTime = 0;
  }

  // Socket handlers
  useEffect(() => {
    socket.on("incomingCall", ({ from }) => {
      ringtoneRef.current.play(); // incoming ringtone
      const accept = confirm(`📞 Incoming call from ${from}. Accept?`);
      if (accept) {
        socket.emit("acceptCall", { from, to: currentUser });
        startCall(from, true);
      } else {
        socket.emit("declineCall", { from, to: currentUser });
        ringtoneRef.current.pause();
        ringtoneRef.current.currentTime = 0;
      }
    });

    socket.on("callAccepted", ({ to }) => {
      startCall(to, false);
    });

    socket.on("callDeclined", ({ to }) => {
      alert(`❌ ${to} declined your call`);
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
      setInCall(false);
    });

    socket.on("offer", async ({ from, offer }) => {
      const stream = await initLocalStream();
      const pc = createPeerConnection(from);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { to: from, from: currentUser, answer });
    });

    socket.on("answer", async ({ from, answer }) => {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      }
    });

    socket.on("iceCandidate", async ({ candidate }) => {
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on("hangUp", ({ from }) => {
      alert(`📴 ${from} ended the call`);
      handleHangUp();
    });

    return () => {
      socket.off("incomingCall");
      socket.off("callAccepted");
      socket.off("callDeclined");
      socket.off("offer");
      socket.off("answer");
      socket.off("iceCandidate");
      socket.off("hangUp");
    };
  }, [currentUser, peerConnection, localStream]);

  return (
    <div className={styles.container}>
      {/* Ringtone */}
      <audio ref={ringtoneRef} src="/ringtone.mp3" loop />
      <audio ref={ringtoneRef2} src="/Phonering.mp3" loop />

      <h2 className={styles.title}>🔐 Register</h2>
      <form onSubmit={handleRegister} className={styles.form}>
        <input
          type="text"
          placeholder="Enter username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className={styles.input}
        />
        <button type="submit" className={styles.button}>Register</button>
      </form>

      <h2 className={styles.title}>📞 Make a Call</h2>
      <form onSubmit={handleCall} className={styles.form}>
        <input
          type="text"
          placeholder="Enter username to call"
          value={callTo}
          onChange={(e) => setCallTo(e.target.value)}
          required
          className={styles.input}
        />
        <button type="submit" className={styles.button}>Call</button>
      </form>

      <h2 className={styles.title}>🎥 Video Chat</h2>
      <div className={styles.videoWrapper}>
        <video ref={localVideoRef} autoPlay playsInline muted className={styles.video} />
        <video ref={remoteVideoRef} autoPlay playsInline className={styles.video} />
      </div>

      {localStream && (
        <div className={styles.controls}>
          <button
            className={styles.controlsButton}
            onClick={() => {
              setIsAudio(!isAudio);
              localStream.getAudioTracks()[0].enabled = !isAudio;
            }}
          >
            {isAudio ? "Mute Audio" : "Unmute Audio"}
          </button>
          <button
            className={styles.controlsButton}
            onClick={() => {
              setIsVideo(!isVideo);
              localStream.getVideoTracks()[0].enabled = !isVideo;
            }}
          >
            {isVideo ? "Hide Video" : "Show Video"}
          </button>
          {inCall && (
            <button className={styles.hangupButton} onClick={handleHangUp}>
              ❌ Hang Up
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FirstPage;
