import {
  AccessToken,
  RoomServiceClient,
  AgentDispatchClient,
  SipClient,
  RoomConfiguration,
  RoomAgentDispatch,
} from 'livekit-server-sdk';
import { toE164 } from '../lib/phone.js';

const AGENT_NAME = 'phonetastic-agent';

/**
 * Interface for LiveKit operations.
 */
export interface LiveKitService {
  /**
   * Purchases a phone number from LiveKit.
   *
   * @param areaCode - Optional preferred area code.
   * @returns The purchased E.164 phone number.
   */
  purchasePhoneNumber(areaCode?: string): Promise<string>;

  /**
   * Creates a LiveKit room.
   *
   * @param name - The room name.
   * @returns The created room name.
   */
  createRoom(name: string): Promise<string>;

  /**
   * Generates a room join token.
   *
   * @param roomName - The LiveKit room name to join.
   * @param participantIdentity - Unique identity for the participant.
   * @returns A signed JWT token for room access.
   */
  generateToken(roomName: string, participantIdentity: string): Promise<string>;

  /**
   * Dispatches the voice agent into a room.
   *
   * @param roomName - The LiveKit room name to dispatch the agent into.
   * @returns Resolves when the dispatch is accepted.
   */
  dispatchAgent(roomName: string): Promise<void>;

  /**
   * Removes a participant from a room by identity, triggering a SIP BYE for SIP participants.
   *
   * @param roomName - The LiveKit room name.
   * @param identity - The participant identity to remove.
   * @returns Resolves when the participant is removed.
   */
  removeParticipant(roomName: string, identity: string): Promise<void>;

  /**
   * Deletes a LiveKit room, disconnecting all participants including SIP callers.
   *
   * @param roomName - The LiveKit room name to delete.
   * @returns Resolves when the room is deleted.
   */
  deleteRoom(roomName: string): Promise<void>;

  /**
   * Creates a SIP dispatch rule that places every caller from the given phone number
   * into a separate room and automatically dispatches the voice agent.
   *
   * @param phoneNumber - The E.164 phone number to match (the trunk/called number).
   * @returns Resolves when the dispatch rule is created.
   */
  createSipDispatchRule(phoneNumber: string): Promise<void>;
}

/**
 * Stub LiveKit service for development and testing.
 */
export class StubLiveKitService implements LiveKitService {
  public readonly purchased: string[] = [];
  public readonly createdRooms: string[] = [];
  public readonly tokenRequests: Array<{ roomName: string; identity: string }> = [];
  public readonly dispatches: string[] = [];

  async purchasePhoneNumber(areaCode?: string): Promise<string> {
    const number = `+1${areaCode ?? '555'}${Math.floor(Math.random() * 9000000 + 1000000)}`;
    this.purchased.push(number);
    return number;
  }

  async createRoom(name: string): Promise<string> {
    this.createdRooms.push(name);
    return name;
  }

  async generateToken(roomName: string, participantIdentity: string): Promise<string> {
    this.tokenRequests.push({ roomName, identity: participantIdentity });
    return 'stub-token';
  }

  async dispatchAgent(roomName: string): Promise<void> {
    this.dispatches.push(roomName);
  }

  async removeParticipant(_roomName: string, _identity: string): Promise<void> {}

  async deleteRoom(roomName: string): Promise<void> {
    const idx = this.createdRooms.indexOf(roomName);
    if (idx !== -1) this.createdRooms.splice(idx, 1);
  }

  async createSipDispatchRule(_phoneNumber: string): Promise<void> {}
}

interface ListNumbersResponse {
  phoneNumbers?: Array<{ phoneNumber: string }>;
}

interface PurchaseNumberResponse {
  phoneNumber: string;
}

/**
 * LiveKit service backed by the livekit-server-sdk.
 *
 * @precondition Valid LiveKit URL, API key, and API secret.
 * @postcondition Rooms are created via RoomServiceClient; tokens dispatch the voice agent on join.
 */
export class LiveKitServiceImpl implements LiveKitService {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly roomService: RoomServiceClient;

  /**
   * @param url - LiveKit server URL (e.g. wss://project.livekit.cloud).
   * @param apiKey - LiveKit API key.
   * @param apiSecret - LiveKit API secret.
   */
  constructor(url: string, apiKey: string, apiSecret: string) {
    this.url = url;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
    this.roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  }

  /** {@inheritDoc LiveKitService.createRoom} */
  async createRoom(name: string): Promise<string> {
    const room = await this.roomService.createRoom({ name, emptyTimeout: 5 * 60 });
    return room.name;
  }

  /** {@inheritDoc LiveKitService.generateToken} */
  async generateToken(roomName: string, participantIdentity: string): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, { identity: participantIdentity });
    token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
    return token.toJwt();
  }

  /** {@inheritDoc LiveKitService.dispatchAgent} */
  async dispatchAgent(roomName: string): Promise<void> {
    const httpUrl = this.url.replace('wss://', 'https://').replace('ws://', 'http://');
    const client = new AgentDispatchClient(httpUrl, this.apiKey, this.apiSecret);
    await client.createDispatch(roomName, AGENT_NAME);
  }

  /** {@inheritDoc LiveKitService.removeParticipant} */
  async removeParticipant(roomName: string, identity: string): Promise<void> {
    await this.roomService.removeParticipant(roomName, identity);
  }

  /** {@inheritDoc LiveKitService.deleteRoom} */
  async deleteRoom(roomName: string): Promise<void> {
    await this.roomService.deleteRoom(roomName);
  }

  /** {@inheritDoc LiveKitService.createSipDispatchRule} */
  async createSipDispatchRule(phoneNumber: string): Promise<void> {
    const httpUrl = this.url.replace('wss://', 'https://').replace('ws://', 'http://');
    const sipClient = new SipClient(httpUrl, this.apiKey, this.apiSecret);
    const trunks = await sipClient.listSipInboundTrunk({ numbers: [phoneNumber] });
    const trunk = trunks.find((t) => t.numbers.includes(phoneNumber));
    if (!trunk) throw new Error(`No SIP trunk found for ${phoneNumber}`);
    await sipClient.createSipDispatchRule(
      { type: 'individual', roomPrefix: 'call-' },
      {
        name: phoneNumber,
        trunkIds: [trunk.sipTrunkId],
        roomConfig: new RoomConfiguration({
          agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
        }),
      },
    );
  }

  /** {@inheritDoc LiveKitService.purchasePhoneNumber} */
  async purchasePhoneNumber(areaCode?: string): Promise<string> {
    const available = await this.callTwirp<ListNumbersResponse>('ListAvailablePhoneNumbers', { areaCode });
    const selected = available.phoneNumbers?.[0]?.phoneNumber;
    if (!selected) throw new Error('No phone numbers available');
    const result = await this.callTwirp<PurchaseNumberResponse>('PurchasePhoneNumber', { phoneNumber: selected });
    return toE164(result.phoneNumber);
  }

  private async callTwirp<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const httpUrl = this.url.replace('wss://', 'https://').replace('ws://', 'http://');
    const token = new AccessToken(this.apiKey, this.apiSecret);
    token.addGrant({ roomAdmin: true });
    const jwt = await token.toJwt();

    const response = await fetch(`${httpUrl}/twirp/livekit.PhoneNumberService/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`LiveKit ${method} failed: ${response.statusText}`);
    return response.json() as Promise<T>;
  }
}

export { AGENT_NAME };
