import "./style.css";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCQDj_kIjyVyxdtYxe32o4I3444nURfyvg",
  authDomain: "newvidioapp.firebaseapp.com",
  projectId: "newvidioapp",
  storageBucket: "newvidioapp.appspot.com",
  messagingSenderId: "987301210449",
  appId: "1:987301210449:web:4a69f0d3c0a5e5865fcb70",
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const callInput = document.getElementById("callInput");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");

// 1. Setup media sources
webcamButton.onclick = async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    remoteStream = new MediaStream();

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Pull tracks from remote stream, add to video stream
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    webcamVideo.srcObject = localStream;
    remoteVideo.srcObject = remoteStream;

    callButton.disabled = false;
    answerButton.disabled = false;
    webcamButton.disabled = true;
  } catch (error) {
    console.error("Error accessing media devices.", error);
  }
};

// 2. Create an offer
callButton.onclick = async () => {
  try {
    const callDoc = firestore.collection("calls").doc();
    const offerCandidates = callDoc.collection("offerCandidates");
    const answerCandidates = callDoc.collection("answerCandidates");

    callInput.value = callDoc.id;

    // Get candidates for caller, save to db
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        offerCandidates.add(event.candidate.toJSON());
      }
    };

    // Create offer
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await callDoc.set({ offer });

    // Listen for remote answer
    const unsubscribeAnswer = callDoc.onSnapshot((snapshot) => {
      const data = snapshot.data();
      if (data?.answer && !pc.currentRemoteDescription) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.setRemoteDescription(answerDescription);
      }
    });

    // When answered, add candidate to peer connection
    const handleAnswerCandidates = (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.addIceCandidate(candidate);
        }
      });
    };

    const unsubscribeAnswerCandidates = answerCandidates.onSnapshot(handleAnswerCandidates);

    hangupButton.disabled = false;

    // Cleanup on hangup
    hangupButton.onclick = () => {
      unsubscribeAnswer();
      unsubscribeAnswerCandidates();
      pc.close();
      localStream.getTracks().forEach(track => track.stop());
      webcamButton.disabled = false;
      callButton.disabled = true;
      answerButton.disabled = true;
      hangupButton.disabled = true;
    };
  } catch (error) {
    console.error("Error creating offer.", error);
  }
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  try {
    const callId = callInput.value;
    const callDoc = firestore.collection("calls").doc(callId);
    const answerCandidates = callDoc.collection("answerCandidates");
    const offerCandidates = callDoc.collection("offerCandidates");

    // Ensure only one `onicecandidate` handler is active
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        answerCandidates.add(event.candidate.toJSON());
      }
    };

    // Fetch the offer from Firestore
    const callData = (await callDoc.get()).data();
    if (!callData || !callData.offer) {
      console.error('No offer found in Firestore.');
      return;
    }

    // Set the remote description with the offer
    const offerDescription = callData.offer;
    await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

    // Create an answer
    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };
    await callDoc.update({ answer });

    // Handle ICE candidates for the offer
    const handleOfferCandidates = (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.addIceCandidate(candidate);
        }
      });
    };

    const unsubscribeOfferCandidates = offerCandidates.onSnapshot(handleOfferCandidates);

    // Cleanup on hangup
    hangupButton.onclick = () => {
      unsubscribeOfferCandidates();
      unsubscribeAnswerCandidates();
      pc.close();
      localStream.getTracks().forEach(track => track.stop());
      webcamButton.disabled = false;
      callButton.disabled = true;
      answerButton.disabled = true;
      hangupButton.disabled = true;
    };
  } catch (error) {
    console.error("Error answering the call.", error);
  }
};
