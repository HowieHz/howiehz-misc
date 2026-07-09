package top.howiehz.graphwar.agent;

import java.io.ByteArrayOutputStream;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.nio.charset.StandardCharsets;
import java.security.ProtectionDomain;

public final class GraphwarRemovePlayerMessageSilencer implements ClassFileTransformer {
    private static final String GAME_DATA = "Graphwar/GameData";
    private static final String HANDLER_CLASS =
            "top/howiehz/graphwar/agent/GraphwarRemovePlayerMessageSilencer";
    private static final String INVALID_MESSAGE_HANDLER = "printUnexpectedInvalidMessage";
    private static final String INVALID_MESSAGE_HANDLER_DESCRIPTOR =
            "(Ljava/lang/Object;Ljava/lang/String;)V";
    private static final String ERROR_HANDLER = "printUnexpectedHandleMessageError";
    private static final String ERROR_HANDLER_DESCRIPTOR = "(Ljava/lang/Exception;)V";
    private static final String INVALID_MESSAGE_METHOD = "invalidMessage";
    private static final String INVALID_MESSAGE_DESCRIPTOR = "(Ljava/lang/String;)V";
    private static final String HANDLE_MESSAGE_METHOD = "handleMessage";
    private static final String HANDLE_MESSAGE_DESCRIPTOR = "(Ljava/lang/String;)V";
    private static final String PRINT_STACK_TRACE_METHOD = "printStackTrace";
    private static final String PRINT_STACK_TRACE_DESCRIPTOR = "()V";
    private static final String REMOVE_PLAYER_MESSAGE_PREFIX = "29&";
    private static final String REMOVE_PLAYER_METHOD = "removePlayerMessage";
    private static final ThreadLocal<String> SUPPRESSED_INVALID_MESSAGE = new ThreadLocal<>();
    private static final int INVOKESPECIAL = 0xb7;
    private static final int INVOKESTATIC = 0xb8;
    private static final int INVOKEVIRTUAL = 0xb6;

    @Override
    public byte[] transform(
            ClassLoader loader,
            String className,
            Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain,
            byte[] classfileBuffer)
            throws IllegalClassFormatException {
        if (!GAME_DATA.equals(className)) {
            return null;
        }

        try {
            byte[] patched = silence(classfileBuffer);
            return patched == classfileBuffer ? null : patched;
        } catch (RuntimeException error) {
            System.err.println(
                    "[graphwar-agent] failed to silence duplicate Graphwar remove-player log in "
                            + className
                            + ": "
                            + error.getMessage());
            return null;
        }
    }

    static byte[] silence(byte[] classfileBuffer) {
        ClassFile classFile = new ClassFile(classfileBuffer);
        if (!classFile.hasInvalidMessageMethodRef()
                || !classFile.hasExceptionPrintStackTraceMethodRef()) {
            return classfileBuffer;
        }

        PatchedConstantPool constantPool = classFile.appendHandlerMethodRefs();
        PatchCounts patchCounts =
                new ClassFile(constantPool.bytes)
                        .patchHandleMessageLogs(
                                constantPool.invalidMessageHandlerMethodRefIndex,
                                constantPool.errorHandlerMethodRefIndex);
        return patchCounts.hasBothPatches() ? constantPool.bytes : classfileBuffer;
    }

    public static void printUnexpectedInvalidMessage(Object gameData, String message) {
        if (isRemovePlayerMessage(message)) {
            SUPPRESSED_INVALID_MESSAGE.set(message);
            return;
        }

        printInvalidMessage(message);
    }

    public static void printUnexpectedHandleMessageError(Exception error) {
        String suppressedMessage = SUPPRESSED_INVALID_MESSAGE.get();
        SUPPRESSED_INVALID_MESSAGE.remove();
        if (suppressedMessage != null && isUnknownRemovePlayerError(error)) {
            return;
        }

        if (suppressedMessage != null) {
            printInvalidMessage(suppressedMessage);
        }
        error.printStackTrace();
    }

    private static boolean isRemovePlayerMessage(String message) {
        return message != null && message.startsWith(REMOVE_PLAYER_MESSAGE_PREFIX);
    }

    private static boolean isUnknownRemovePlayerError(Exception error) {
        if (!(error instanceof NullPointerException)) {
            return false;
        }

        StackTraceElement[] stackTrace = error.getStackTrace();
        return stackTrace.length > 0
                && GAME_DATA.replace('/', '.').equals(stackTrace[0].getClassName())
                && REMOVE_PLAYER_METHOD.equals(stackTrace[0].getMethodName());
    }

    private static void printInvalidMessage(String message) {
        System.out.println("Invalid message received: " + message);
    }

    private static final class PatchedConstantPool {
        final byte[] bytes;
        final int errorHandlerMethodRefIndex;
        final int invalidMessageHandlerMethodRefIndex;

        PatchedConstantPool(
                byte[] bytes,
                int invalidMessageHandlerMethodRefIndex,
                int errorHandlerMethodRefIndex) {
            this.bytes = bytes;
            this.invalidMessageHandlerMethodRefIndex = invalidMessageHandlerMethodRefIndex;
            this.errorHandlerMethodRefIndex = errorHandlerMethodRefIndex;
        }
    }

    private static final class PatchCounts {
        int errorPrintStackTrace;
        int invalidMessage;

        boolean hasBothPatches() {
            return invalidMessage > 0 && errorPrintStackTrace > 0;
        }
    }

    private static final class ClassFile {
        private final byte[] bytes;
        private final int constantPoolCount;
        private final int[] classNameIndexes;
        private final int[] methodRefClassIndexes;
        private final int[] methodRefNameAndTypeIndexes;
        private final int[] nameAndTypeDescriptorIndexes;
        private final int[] nameAndTypeNameIndexes;
        private final String[] utf8Values;
        private final int afterConstantPoolOffset;

        ClassFile(byte[] bytes) {
            this.bytes = bytes;
            if (readU4(0) != 0xcafebabe) {
                throw new IllegalArgumentException("not a class file");
            }

            this.constantPoolCount = readU2(8);
            this.classNameIndexes = new int[constantPoolCount];
            this.methodRefClassIndexes = new int[constantPoolCount];
            this.methodRefNameAndTypeIndexes = new int[constantPoolCount];
            this.nameAndTypeDescriptorIndexes = new int[constantPoolCount];
            this.nameAndTypeNameIndexes = new int[constantPoolCount];
            this.utf8Values = new String[constantPoolCount];
            this.afterConstantPoolOffset = readConstantPool();
        }

        boolean hasInvalidMessageMethodRef() {
            for (int index = 1; index < methodRefClassIndexes.length; index += 1) {
                if (isInvalidMessageMethodRef(index)) {
                    return true;
                }
            }
            return false;
        }

        boolean hasExceptionPrintStackTraceMethodRef() {
            for (int index = 1; index < methodRefClassIndexes.length; index += 1) {
                if (isExceptionPrintStackTraceMethodRef(index)) {
                    return true;
                }
            }
            return false;
        }

        PatchedConstantPool appendHandlerMethodRefs() {
            int handlerClassUtf8Index = constantPoolCount;
            int handlerClassIndex = handlerClassUtf8Index + 1;
            int invalidHandlerNameIndex = handlerClassIndex + 1;
            int invalidHandlerDescriptorIndex = invalidHandlerNameIndex + 1;
            int invalidHandlerNameAndTypeIndex = invalidHandlerDescriptorIndex + 1;
            int invalidHandlerMethodRefIndex = invalidHandlerNameAndTypeIndex + 1;
            int errorHandlerNameIndex = invalidHandlerMethodRefIndex + 1;
            int errorHandlerDescriptorIndex = errorHandlerNameIndex + 1;
            int errorHandlerNameAndTypeIndex = errorHandlerDescriptorIndex + 1;
            int errorHandlerMethodRefIndex = errorHandlerNameAndTypeIndex + 1;
            int newConstantPoolCount = errorHandlerMethodRefIndex + 1;
            if (newConstantPoolCount > 0xffff) {
                throw new IllegalArgumentException("constant pool is full");
            }

            ByteArrayOutputStream entries = new ByteArrayOutputStream(256);
            writeUtf8(entries, HANDLER_CLASS);
            writeClass(entries, handlerClassUtf8Index);
            writeUtf8(entries, INVALID_MESSAGE_HANDLER);
            writeUtf8(entries, INVALID_MESSAGE_HANDLER_DESCRIPTOR);
            writeNameAndType(entries, invalidHandlerNameIndex, invalidHandlerDescriptorIndex);
            writeMethodRef(entries, handlerClassIndex, invalidHandlerNameAndTypeIndex);
            writeUtf8(entries, ERROR_HANDLER);
            writeUtf8(entries, ERROR_HANDLER_DESCRIPTOR);
            writeNameAndType(entries, errorHandlerNameIndex, errorHandlerDescriptorIndex);
            writeMethodRef(entries, handlerClassIndex, errorHandlerNameAndTypeIndex);

            byte[] entryBytes = entries.toByteArray();
            byte[] patched = new byte[bytes.length + entryBytes.length];
            System.arraycopy(bytes, 0, patched, 0, afterConstantPoolOffset);
            System.arraycopy(entryBytes, 0, patched, afterConstantPoolOffset, entryBytes.length);
            System.arraycopy(
                    bytes,
                    afterConstantPoolOffset,
                    patched,
                    afterConstantPoolOffset + entryBytes.length,
                    bytes.length - afterConstantPoolOffset);
            writeU2(patched, 8, newConstantPoolCount);
            return new PatchedConstantPool(
                    patched, invalidHandlerMethodRefIndex, errorHandlerMethodRefIndex);
        }

        PatchCounts patchHandleMessageLogs(
                int invalidMessageHandlerMethodRefIndex, int errorHandlerMethodRefIndex) {
            int offset = afterConstantPoolOffset;
            offset += 6; // access_flags, this_class, super_class
            int interfacesCount = readU2(offset);
            offset += 2 + interfacesCount * 2;

            int fieldsCount = readU2(offset);
            offset += 2;
            for (int index = 0; index < fieldsCount; index += 1) {
                offset = skipMember(offset);
            }

            PatchCounts patchCounts = new PatchCounts();
            int methodsCount = readU2(offset);
            offset += 2;
            for (int index = 0; index < methodsCount; index += 1) {
                int methodNameIndex = readU2(offset + 2);
                int methodDescriptorIndex = readU2(offset + 4);
                boolean isHandleMessageMethod =
                        HANDLE_MESSAGE_METHOD.equals(utf8Values[methodNameIndex])
                                && HANDLE_MESSAGE_DESCRIPTOR.equals(
                                        utf8Values[methodDescriptorIndex]);
                offset += 6; // access_flags, name_index, descriptor_index
                int attributesCount = readU2(offset);
                offset += 2;
                for (int attributeIndex = 0;
                        attributeIndex < attributesCount;
                        attributeIndex += 1) {
                    int attributeNameIndex = readU2(offset);
                    int attributeLength = readU4(offset + 2);
                    int infoOffset = offset + 6;
                    if (isHandleMessageMethod && "Code".equals(utf8Values[attributeNameIndex])) {
                        patchCodeAttribute(
                                infoOffset,
                                invalidMessageHandlerMethodRefIndex,
                                errorHandlerMethodRefIndex,
                                patchCounts);
                    }
                    offset = infoOffset + attributeLength;
                }
            }
            return patchCounts;
        }

        private int readConstantPool() {
            int offset = 10;
            for (int index = 1; index < constantPoolCount; index += 1) {
                int tag = readU1(offset);
                offset += 1;
                switch (tag) {
                    case 1:
                        int length = readU2(offset);
                        offset += 2;
                        utf8Values[index] =
                                new String(bytes, offset, length, StandardCharsets.UTF_8);
                        offset += length;
                        break;
                    case 3:
                    case 4:
                        offset += 4;
                        break;
                    case 5:
                    case 6:
                        offset += 8;
                        index += 1;
                        break;
                    case 7:
                        classNameIndexes[index] = readU2(offset);
                        offset += 2;
                        break;
                    case 8:
                    case 16:
                    case 19:
                    case 20:
                        offset += 2;
                        break;
                    case 9:
                    case 10:
                    case 11:
                        if (tag == 10) {
                            methodRefClassIndexes[index] = readU2(offset);
                            methodRefNameAndTypeIndexes[index] = readU2(offset + 2);
                        }
                        offset += 4;
                        break;
                    case 12:
                        nameAndTypeNameIndexes[index] = readU2(offset);
                        nameAndTypeDescriptorIndexes[index] = readU2(offset + 2);
                        offset += 4;
                        break;
                    case 15:
                        offset += 3;
                        break;
                    case 17:
                    case 18:
                        offset += 4;
                        break;
                    default:
                        throw new IllegalArgumentException("unsupported constant pool tag " + tag);
                }
            }
            return offset;
        }

        private int skipMember(int offset) {
            offset += 6; // access_flags, name_index, descriptor_index
            int attributesCount = readU2(offset);
            offset += 2;
            for (int index = 0; index < attributesCount; index += 1) {
                int attributeLength = readU4(offset + 2);
                offset += 6 + attributeLength;
            }
            return offset;
        }

        private void patchCodeAttribute(
                int infoOffset,
                int invalidMessageHandlerMethodRefIndex,
                int errorHandlerMethodRefIndex,
                PatchCounts patchCounts) {
            int codeLength = readU4(infoOffset + 4);
            int codeOffset = infoOffset + 8;
            int codeEnd = codeOffset + codeLength;

            // Same-length replacements preserve branches, exception tables and frames.
            // Walk instruction starts only; raw byte scanning could mutate operands.
            for (int offset = codeOffset;
                    offset < codeEnd;
                    offset =
                            GraphwarBytecodeInstructions.nextOffset(
                                    bytes, codeOffset, codeEnd, offset)) {
                int opcode = readU1(offset);
                if (opcode == INVOKESPECIAL
                        && offset + 2 < codeEnd
                        && isInvalidMessageMethodRef(readU2(offset + 1))) {
                    bytes[offset] = (byte) INVOKESTATIC;
                    writeU2(bytes, offset + 1, invalidMessageHandlerMethodRefIndex);
                    patchCounts.invalidMessage += 1;
                } else if (opcode == INVOKEVIRTUAL
                        && offset + 2 < codeEnd
                        && isExceptionPrintStackTraceMethodRef(readU2(offset + 1))) {
                    bytes[offset] = (byte) INVOKESTATIC;
                    writeU2(bytes, offset + 1, errorHandlerMethodRefIndex);
                    patchCounts.errorPrintStackTrace += 1;
                }
            }
        }

        private boolean isInvalidMessageMethodRef(int constantPoolIndex) {
            return isMethodRef(
                    constantPoolIndex,
                    GAME_DATA,
                    INVALID_MESSAGE_METHOD,
                    INVALID_MESSAGE_DESCRIPTOR);
        }

        private boolean isExceptionPrintStackTraceMethodRef(int constantPoolIndex) {
            if (constantPoolIndex <= 0 || constantPoolIndex >= methodRefClassIndexes.length) {
                return false;
            }

            int classIndex = methodRefClassIndexes[constantPoolIndex];
            int nameAndTypeIndex = methodRefNameAndTypeIndexes[constantPoolIndex];
            if (classIndex == 0 || nameAndTypeIndex == 0) {
                return false;
            }

            String className = utf8Values[classNameIndexes[classIndex]];
            String methodName = utf8Values[nameAndTypeNameIndexes[nameAndTypeIndex]];
            String descriptor = utf8Values[nameAndTypeDescriptorIndexes[nameAndTypeIndex]];
            return "java/lang/Exception".equals(className)
                    && PRINT_STACK_TRACE_METHOD.equals(methodName)
                    && PRINT_STACK_TRACE_DESCRIPTOR.equals(descriptor);
        }

        private boolean isMethodRef(
                int constantPoolIndex, String className, String methodName, String descriptor) {
            if (constantPoolIndex <= 0 || constantPoolIndex >= methodRefClassIndexes.length) {
                return false;
            }

            int classIndex = methodRefClassIndexes[constantPoolIndex];
            int nameAndTypeIndex = methodRefNameAndTypeIndexes[constantPoolIndex];
            if (classIndex == 0 || nameAndTypeIndex == 0) {
                return false;
            }

            return className.equals(utf8Values[classNameIndexes[classIndex]])
                    && methodName.equals(utf8Values[nameAndTypeNameIndexes[nameAndTypeIndex]])
                    && descriptor.equals(
                            utf8Values[nameAndTypeDescriptorIndexes[nameAndTypeIndex]]);
        }

        private int readU1(int offset) {
            return bytes[offset] & 0xff;
        }

        private int readU2(int offset) {
            return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
        }

        private int readU4(int offset) {
            return (readU2(offset) << 16) | readU2(offset + 2);
        }
    }

    private static void writeClass(ByteArrayOutputStream output, int nameIndex) {
        writeU1(output, 7);
        writeU2(output, nameIndex);
    }

    private static void writeMethodRef(
            ByteArrayOutputStream output, int classIndex, int nameAndTypeIndex) {
        writeU1(output, 10);
        writeU2(output, classIndex);
        writeU2(output, nameAndTypeIndex);
    }

    private static void writeNameAndType(
            ByteArrayOutputStream output, int nameIndex, int descriptorIndex) {
        writeU1(output, 12);
        writeU2(output, nameIndex);
        writeU2(output, descriptorIndex);
    }

    private static void writeUtf8(ByteArrayOutputStream output, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 0xffff) {
            throw new IllegalArgumentException("UTF-8 constant is too long");
        }
        writeU1(output, 1);
        writeU2(output, bytes.length);
        output.write(bytes, 0, bytes.length);
    }

    private static void writeU1(ByteArrayOutputStream output, int value) {
        output.write(value & 0xff);
    }

    private static void writeU2(ByteArrayOutputStream output, int value) {
        writeU1(output, value >>> 8);
        writeU1(output, value);
    }

    private static void writeU2(byte[] bytes, int offset, int value) {
        bytes[offset] = (byte) ((value >>> 8) & 0xff);
        bytes[offset + 1] = (byte) (value & 0xff);
    }
}
