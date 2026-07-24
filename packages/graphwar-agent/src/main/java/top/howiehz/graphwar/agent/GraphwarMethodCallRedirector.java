package top.howiehz.graphwar.agent;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/** Replaces selected JVM method calls with same-size static handler calls. */
final class GraphwarMethodCallRedirector {
    static final int ANY_INSTANCE_OPCODE = 0;
    static final int INVOKESPECIAL = 0xb7;
    static final int INVOKESTATIC = 0xb8;
    static final int INVOKEVIRTUAL = 0xb6;

    /** Prevents construction of this class-file utility. */
    private GraphwarMethodCallRedirector() {}

    /** Appends one handler reference and redirects every matching instruction. */
    static byte[] redirect(byte[] classfileBuffer, Redirect redirect) {
        ClassFile original = new ClassFile(classfileBuffer);
        if (!original.hasSourceMethodRef(redirect)) {
            return classfileBuffer;
        }
        PatchedConstantPool constantPool = original.appendHandlerMethodRef(redirect);
        int patchCount =
                new ClassFile(constantPool.bytes)
                        .patchMethodCalls(redirect, constantPool.handlerMethodRefIndex);
        return patchCount == 0 ? classfileBuffer : constantPool.bytes;
    }

    /** Describes one verifier-safe call replacement with an explicit receiver parameter. */
    static final class Redirect {
        final String handlerClass;
        final String handlerDescriptor;
        final String handlerMethod;
        final String sourceClass;
        final String sourceDescriptor;
        final String sourceMethod;
        final int sourceOpcode;

        /** Retains exact source and target symbols used by the class-file matcher. */
        Redirect(
                int sourceOpcode,
                String sourceClass,
                String sourceMethod,
                String sourceDescriptor,
                String handlerClass,
                String handlerMethod,
                String handlerDescriptor) {
            this.handlerClass = handlerClass;
            this.handlerDescriptor = handlerDescriptor;
            this.handlerMethod = handlerMethod;
            this.sourceClass = sourceClass;
            this.sourceDescriptor = sourceDescriptor;
            this.sourceMethod = sourceMethod;
            this.sourceOpcode = sourceOpcode;
        }
    }

    private static final class PatchedConstantPool {
        final byte[] bytes;
        final int handlerMethodRefIndex;

        /** Couples expanded bytes with the appended method-reference index. */
        PatchedConstantPool(byte[] bytes, int handlerMethodRefIndex) {
            this.bytes = bytes;
            this.handlerMethodRefIndex = handlerMethodRefIndex;
        }
    }

    private static final class ClassFile {
        private final int afterConstantPoolOffset;
        private final byte[] bytes;
        private final int[] classNameIndexes;
        private final int constantPoolCount;
        private final int[] methodRefClassIndexes;
        private final int[] methodRefNameAndTypeIndexes;
        private final int[] nameAndTypeDescriptorIndexes;
        private final int[] nameAndTypeNameIndexes;
        private final String[] utf8Values;

        /** Parses only constant-pool and method metadata required for call redirection. */
        ClassFile(byte[] bytes) {
            this.bytes = bytes;
            if (readU4(0) != 0xcafebabe) {
                throw new IllegalArgumentException("not a class file");
            }
            constantPoolCount = readU2(8);
            classNameIndexes = new int[constantPoolCount];
            methodRefClassIndexes = new int[constantPoolCount];
            methodRefNameAndTypeIndexes = new int[constantPoolCount];
            nameAndTypeDescriptorIndexes = new int[constantPoolCount];
            nameAndTypeNameIndexes = new int[constantPoolCount];
            utf8Values = new String[constantPoolCount];
            afterConstantPoolOffset = readConstantPool();
        }

        /** Reports whether the original class references the exact call to replace. */
        boolean hasSourceMethodRef(Redirect redirect) {
            for (int index = 1; index < methodRefClassIndexes.length; index += 1) {
                if (isSourceMethodRef(index, redirect)) {
                    return true;
                }
            }
            return false;
        }

        /** Adds one static handler method reference without changing existing indexes. */
        PatchedConstantPool appendHandlerMethodRef(Redirect redirect) {
            int classNameIndex = constantPoolCount;
            int classIndex = classNameIndex + 1;
            int methodNameIndex = classIndex + 1;
            int descriptorIndex = methodNameIndex + 1;
            int nameAndTypeIndex = descriptorIndex + 1;
            int methodRefIndex = nameAndTypeIndex + 1;
            int newConstantPoolCount = methodRefIndex + 1;
            if (newConstantPoolCount > 0xffff) {
                throw new IllegalArgumentException("constant pool is full");
            }

            ByteArrayOutputStream entries = new ByteArrayOutputStream(192);
            writeUtf8(entries, redirect.handlerClass);
            writeClass(entries, classNameIndex);
            writeUtf8(entries, redirect.handlerMethod);
            writeUtf8(entries, redirect.handlerDescriptor);
            writeNameAndType(entries, methodNameIndex, descriptorIndex);
            writeMethodRef(entries, classIndex, nameAndTypeIndex);

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
            return new PatchedConstantPool(patched, methodRefIndex);
        }

        /** Rewrites matching calls while preserving code length, branches and stack frames. */
        int patchMethodCalls(Redirect redirect, int handlerMethodRefIndex) {
            int offset = afterConstantPoolOffset;
            offset += 6;
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
                offset += 6;
                int attributesCount = readU2(offset);
                offset += 2;
                for (int attributeIndex = 0;
                        attributeIndex < attributesCount;
                        attributeIndex += 1) {
                    int attributeNameIndex = readU2(offset);
                    int attributeLength = readU4(offset + 2);
                    int infoOffset = offset + 6;
                    if ("Code".equals(utf8Values[attributeNameIndex])) {
                        patchCount +=
                                patchCodeAttribute(infoOffset, redirect, handlerMethodRefIndex);
                    }
                    offset = infoOffset + attributeLength;
                }
            }
            return patchCount;
        }

        /** Rewrites matching calls inside one Code attribute without shifting byte offsets. */
        private int patchCodeAttribute(
                int infoOffset, Redirect redirect, int handlerMethodRefIndex) {
            int codeLength = readU4(infoOffset + 4);
            int codeOffset = infoOffset + 8;
            int codeEnd = codeOffset + codeLength;
            int patchCount = 0;
            for (int offset = codeOffset;
                    offset < codeEnd;
                    offset =
                            GraphwarBytecodeInstructions.nextOffset(
                                    bytes, codeOffset, codeEnd, offset)) {
                int opcode = readU1(offset);
                if ((opcode == redirect.sourceOpcode
                                || (redirect.sourceOpcode == 0
                                        && (opcode == INVOKESPECIAL || opcode == INVOKEVIRTUAL)))
                        && offset + 2 < codeEnd
                        && isSourceMethodRef(readU2(offset + 1), redirect)) {
                    bytes[offset] = (byte) INVOKESTATIC;
                    writeU2(bytes, offset + 1, handlerMethodRefIndex);
                    patchCount += 1;
                }
            }
            return patchCount;
        }

        /** Matches one constant-pool method reference against the requested source symbol. */
        private boolean isSourceMethodRef(int index, Redirect redirect) {
            if (index <= 0 || index >= methodRefClassIndexes.length) {
                return false;
            }
            int classIndex = methodRefClassIndexes[index];
            int nameAndTypeIndex = methodRefNameAndTypeIndexes[index];
            return classIndex != 0
                    && nameAndTypeIndex != 0
                    && redirect.sourceClass.equals(utf8Values[classNameIndexes[classIndex]])
                    && redirect.sourceMethod.equals(
                            utf8Values[nameAndTypeNameIndexes[nameAndTypeIndex]])
                    && redirect.sourceDescriptor.equals(
                            utf8Values[nameAndTypeDescriptorIndexes[nameAndTypeIndex]]);
        }

        /** Indexes the constant-pool entries needed by the method-reference matcher. */
        private int readConstantPool() {
            int offset = 10;
            for (int index = 1; index < constantPoolCount; index += 1) {
                int tag = readU1(offset++);
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

        /** Advances over one field or method_info structure and all of its attributes. */
        private int skipMember(int offset) {
            offset += 6;
            int attributesCount = readU2(offset);
            offset += 2;
            for (int index = 0; index < attributesCount; index += 1) {
                offset += 6 + readU4(offset + 2);
            }
            return offset;
        }

        /** Reads one unsigned class-file byte. */
        private int readU1(int offset) {
            return bytes[offset] & 0xff;
        }

        /** Reads one unsigned class-file short in big-endian order. */
        private int readU2(int offset) {
            return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
        }

        /** Reads one four-byte class-file value in big-endian order. */
        private int readU4(int offset) {
            return (readU2(offset) << 16) | readU2(offset + 2);
        }
    }

    /** Appends one CONSTANT_Class entry. */
    private static void writeClass(ByteArrayOutputStream output, int nameIndex) {
        writeU1(output, 7);
        writeU2(output, nameIndex);
    }

    /** Appends one CONSTANT_Methodref entry. */
    private static void writeMethodRef(
            ByteArrayOutputStream output, int classIndex, int nameAndTypeIndex) {
        writeU1(output, 10);
        writeU2(output, classIndex);
        writeU2(output, nameAndTypeIndex);
    }

    /** Appends one CONSTANT_NameAndType entry. */
    private static void writeNameAndType(
            ByteArrayOutputStream output, int nameIndex, int descriptorIndex) {
        writeU1(output, 12);
        writeU2(output, nameIndex);
        writeU2(output, descriptorIndex);
    }

    /** Appends one ASCII-compatible CONSTANT_Utf8 symbol used by the handler reference. */
    private static void writeUtf8(ByteArrayOutputStream output, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        writeU1(output, 1);
        writeU2(output, bytes.length);
        output.write(bytes, 0, bytes.length);
    }

    /** Appends the low byte of one class-file value. */
    private static void writeU1(ByteArrayOutputStream output, int value) {
        output.write(value & 0xff);
    }

    /** Appends one class-file short in big-endian order. */
    private static void writeU2(ByteArrayOutputStream output, int value) {
        writeU1(output, value >>> 8);
        writeU1(output, value);
    }

    /** Overwrites one class-file short in big-endian order. */
    private static void writeU2(byte[] bytes, int offset, int value) {
        bytes[offset] = (byte) (value >>> 8);
        bytes[offset + 1] = (byte) value;
    }
}
