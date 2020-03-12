import {
    IDataBuffer,
} from '../../types';

export enum FramerState {
    ParsingHeader = 1,
    ParsingBody,
};

export type WSState = {
    isFinished: boolean;
    rsv1: number;
    rsv2: number;
    rsv3: number;
    opcode: number;

    isMasked: boolean;
    currentMask: IDataBuffer;

    currentHeader: IDataBuffer;
    currentHeaderLen: number;

    isControlFrame: boolean;
    state: FramerState;

    payload: IDataBuffer;
    payloadLength: number;
    payloadPtr: number;
    payloads?: IDataBuffer[];
};

export const MASK_SIZE = 4;
export const MAX_HEADER_SIZE = 14;
export type WSCallback = (buffer: IDataBuffer, state: WSState) => void;

