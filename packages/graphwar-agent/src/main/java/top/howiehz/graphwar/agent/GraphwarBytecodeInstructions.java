package top.howiehz.graphwar.agent;

final class GraphwarBytecodeInstructions {
    private static final int IINC = 0x84;
    private static final int LOOKUPSWITCH = 0xab;
    private static final int TABLESWITCH = 0xaa;
    private static final int WIDE = 0xc4;

    private GraphwarBytecodeInstructions() {}

    static int nextOffset(byte[] bytes, int codeOffset, int codeEnd, int offset) {
        int instructionLength = readInstructionLength(bytes, codeOffset, codeEnd, offset);
        int nextOffset = offset + instructionLength;
        if (instructionLength <= 0 || nextOffset > codeEnd) {
            throw new IllegalArgumentException(
                    "invalid bytecode instruction at " + (offset - codeOffset));
        }
        return nextOffset;
    }

    private static int readInstructionLength(
            byte[] bytes, int codeOffset, int codeEnd, int offset) {
        int opcode = readU1(bytes, offset);
        switch (opcode) {
            case TABLESWITCH:
                return readTableSwitchInstructionLength(bytes, codeOffset, codeEnd, offset);
            case LOOKUPSWITCH:
                return readLookupSwitchInstructionLength(bytes, codeOffset, codeEnd, offset);
            case WIDE:
                return readWideInstructionLength(bytes, codeEnd, offset);
            case 0x10:
            case 0x12:
            case 0xbc:
                return 2;
            case 0x11:
            case 0x13:
            case 0x14:
            case IINC:
                return 3;
            case 0xb9:
            case 0xba:
            case 0xc8:
            case 0xc9:
                return 5;
            case 0xc5:
                return 4;
            default:
                if (opcode <= 0x0f
                        || (opcode >= 0x1a && opcode <= 0x35)
                        || (opcode >= 0x3b && opcode <= 0x83)
                        || (opcode >= 0x85 && opcode <= 0x98)
                        || (opcode >= 0xac && opcode <= 0xb1)
                        || opcode == 0xbe
                        || opcode == 0xbf
                        || opcode == 0xc2
                        || opcode == 0xc3
                        || opcode == 0xca
                        || opcode == 0xfe
                        || opcode == 0xff) {
                    return 1;
                }
                if ((opcode >= 0x15 && opcode <= 0x19)
                        || (opcode >= 0x36 && opcode <= 0x3a)
                        || opcode == 0xa9) {
                    return 2;
                }
                if ((opcode >= 0x99 && opcode <= 0xa8)
                        || (opcode >= 0xb2 && opcode <= 0xb8)
                        || opcode == 0xbb
                        || opcode == 0xbd
                        || opcode == 0xc0
                        || opcode == 0xc1
                        || (opcode >= 0xc6 && opcode <= 0xc7)) {
                    return 3;
                }
                throw new IllegalArgumentException(
                        "unsupported bytecode opcode 0x" + Integer.toHexString(opcode));
        }
    }

    private static int readTableSwitchInstructionLength(
            byte[] bytes, int codeOffset, int codeEnd, int offset) {
        int cursor = switchPayloadOffset(codeOffset, offset);
        if (cursor + 12 > codeEnd) {
            throw new IllegalArgumentException("truncated tableswitch at " + (offset - codeOffset));
        }

        int low = readS4(bytes, cursor + 4);
        int high = readS4(bytes, cursor + 8);
        long caseCount = (long) high - low + 1L;
        if (caseCount < 1L) {
            throw new IllegalArgumentException(
                    "invalid tableswitch case range at " + (offset - codeOffset));
        }
        long length = (long) (cursor - offset) + 12L + caseCount * 4L;
        return checkedVariableInstructionLength(length, codeOffset, codeEnd, offset);
    }

    private static int readLookupSwitchInstructionLength(
            byte[] bytes, int codeOffset, int codeEnd, int offset) {
        int cursor = switchPayloadOffset(codeOffset, offset);
        if (cursor + 8 > codeEnd) {
            throw new IllegalArgumentException(
                    "truncated lookupswitch at " + (offset - codeOffset));
        }

        int pairCount = readS4(bytes, cursor + 4);
        if (pairCount < 0) {
            throw new IllegalArgumentException(
                    "invalid lookupswitch pair count at " + (offset - codeOffset));
        }
        long length = (long) (cursor - offset) + 8L + (long) pairCount * 8L;
        return checkedVariableInstructionLength(length, codeOffset, codeEnd, offset);
    }

    private static int readWideInstructionLength(byte[] bytes, int codeEnd, int offset) {
        if (offset + 1 >= codeEnd) {
            throw new IllegalArgumentException("truncated wide instruction");
        }
        return readU1(bytes, offset + 1) == IINC ? 6 : 4;
    }

    private static int switchPayloadOffset(int codeOffset, int offset) {
        int afterOpcode = offset + 1;
        int padding = (4 - ((afterOpcode - codeOffset) & 3)) & 3;
        return afterOpcode + padding;
    }

    private static int checkedVariableInstructionLength(
            long length, int codeOffset, int codeEnd, int offset) {
        if (length <= 0L || length > codeEnd - offset) {
            throw new IllegalArgumentException(
                    "invalid variable-length bytecode instruction at " + (offset - codeOffset));
        }
        return (int) length;
    }

    private static int readU1(byte[] bytes, int offset) {
        return bytes[offset] & 0xff;
    }

    private static int readS4(byte[] bytes, int offset) {
        return (readU2(bytes, offset) << 16) | readU2(bytes, offset + 2);
    }

    private static int readU2(byte[] bytes, int offset) {
        return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
    }
}
