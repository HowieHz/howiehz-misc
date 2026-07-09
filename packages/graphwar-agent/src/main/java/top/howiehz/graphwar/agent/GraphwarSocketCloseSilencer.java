package top.howiehz.graphwar.agent;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.security.ProtectionDomain;

public final class GraphwarSocketCloseSilencer implements ClassFileTransformer {
    private static final String CLIENT_SERVER_CONNECTION = "Graphwar/ServerConnection";
    private static final String HANDLER_CLASS =
            "top/howiehz/graphwar/agent/GraphwarSocketCloseSilencer";
    private static final String HANDLER_METHOD = "printUnexpectedServerConnectionReadError";
    private static final String HANDLER_DESCRIPTOR = "(Ljava/io/IOException;)V";
    private static final String SOCKET_CLOSED_MESSAGE = "Socket closed";
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
        if (!CLIENT_SERVER_CONNECTION.equals(className)) {
            return null;
        }

        try {
            byte[] patched = silence(classfileBuffer);
            return patched == classfileBuffer ? null : patched;
        } catch (RuntimeException error) {
            System.err.println(
                    "[graphwar-agent] failed to silence normal Graphwar socket close log in "
                            + className
                            + ": "
                            + error.getMessage());
            return null;
        }
    }

    static byte[] silence(byte[] classfileBuffer) {
        ClassFile classFile = new ClassFile(classfileBuffer);
        if (!classFile.hasIOExceptionPrintStackTraceMethodRef()) {
            return classfileBuffer;
        }

        PatchedConstantPool constantPool = classFile.appendHandlerMethodRef();
        int patchCount =
                new ClassFile(constantPool.bytes)
                        .patchServerConnectionRunPrintStackTrace(
                                constantPool.handlerMethodRefIndex);
        return patchCount == 0 ? classfileBuffer : constantPool.bytes;
    }

    public static void printUnexpectedServerConnectionReadError(IOException error) {
        // ServerConnection.disconnect() closes the socket while the read thread may still be
        // blocked in readLine(); the resulting SocketException("Socket closed") is expected.
        if (error instanceof SocketException && SOCKET_CLOSED_MESSAGE.equals(error.getMessage())) {
            return;
        }

        error.printStackTrace();
    }

    private static final class PatchedConstantPool {
        final byte[] bytes;
        final int handlerMethodRefIndex;

        PatchedConstantPool(byte[] bytes, int handlerMethodRefIndex) {
            this.bytes = bytes;
            this.handlerMethodRefIndex = handlerMethodRefIndex;
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

        boolean hasIOExceptionPrintStackTraceMethodRef() {
            for (int index = 1; index < methodRefClassIndexes.length; index += 1) {
                if (isIOExceptionPrintStackTraceMethodRef(index)) {
                    return true;
                }
            }
            return false;
        }

        PatchedConstantPool appendHandlerMethodRef() {
            int handlerClassUtf8Index = constantPoolCount;
            int handlerClassIndex = handlerClassUtf8Index + 1;
            int handlerMethodNameIndex = handlerClassIndex + 1;
            int handlerDescriptorIndex = handlerMethodNameIndex + 1;
            int handlerNameAndTypeIndex = handlerDescriptorIndex + 1;
            int handlerMethodRefIndex = handlerNameAndTypeIndex + 1;
            int newConstantPoolCount = handlerMethodRefIndex + 1;
            if (newConstantPoolCount > 0xffff) {
                throw new IllegalArgumentException("constant pool is full");
            }

            ByteArrayOutputStream entries = new ByteArrayOutputStream(192);
            writeUtf8(entries, HANDLER_CLASS);
            writeClass(entries, handlerClassUtf8Index);
            writeUtf8(entries, HANDLER_METHOD);
            writeUtf8(entries, HANDLER_DESCRIPTOR);
            writeNameAndType(entries, handlerMethodNameIndex, handlerDescriptorIndex);
            writeMethodRef(entries, handlerClassIndex, handlerNameAndTypeIndex);

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
            return new PatchedConstantPool(patched, handlerMethodRefIndex);
        }

        int patchServerConnectionRunPrintStackTrace(int handlerMethodRefIndex) {
            int offset = afterConstantPoolOffset;
            offset += 6; // access_flags, this_class, super_class
            int interfacesCount = readU2(offset);
            offset += 2 + interfacesCount * 2;

            int fieldsCount = readU2(offset);
            offset += 2;
            for (int index = 0; index < fieldsCount; index += 1) {
                offset = skipMember(offset);
            }

            int patchCount = 0;
            int methodsCount = readU2(offset);
            offset += 2;
            for (int index = 0; index < methodsCount; index += 1) {
                int methodNameIndex = readU2(offset + 2);
                int methodDescriptorIndex = readU2(offset + 4);
                boolean isRunMethod =
                        "run".equals(utf8Values[methodNameIndex])
                                && "()V".equals(utf8Values[methodDescriptorIndex]);
                offset += 6; // access_flags, name_index, descriptor_index
                int attributesCount = readU2(offset);
                offset += 2;
                for (int attributeIndex = 0;
                        attributeIndex < attributesCount;
                        attributeIndex += 1) {
                    int attributeNameIndex = readU2(offset);
                    int attributeLength = readU4(offset + 2);
                    int infoOffset = offset + 6;
                    if (isRunMethod && "Code".equals(utf8Values[attributeNameIndex])) {
                        patchCount += patchCodeAttribute(infoOffset, handlerMethodRefIndex);
                    }
                    offset = infoOffset + attributeLength;
                }
            }
            return patchCount;
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

        private int patchCodeAttribute(int infoOffset, int handlerMethodRefIndex) {
            int codeLength = readU4(infoOffset + 4);
            int codeOffset = infoOffset + 8;
            int codeEnd = codeOffset + codeLength;
            int patchCount = 0;

            // Same-length replacement keeps branch offsets, exception tables and frames valid.
            for (int offset = codeOffset; offset + 2 < codeEnd; offset += 1) {
                if (readU1(offset) == INVOKEVIRTUAL
                        && isIOExceptionPrintStackTraceMethodRef(readU2(offset + 1))) {
                    bytes[offset] = (byte) INVOKESTATIC;
                    writeU2(bytes, offset + 1, handlerMethodRefIndex);
                    patchCount += 1;
                }
            }

            return patchCount;
        }

        private boolean isIOExceptionPrintStackTraceMethodRef(int constantPoolIndex) {
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
            return "java/io/IOException".equals(className)
                    && "printStackTrace".equals(methodName)
                    && "()V".equals(descriptor);
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
