package top.howiehz.graphwar.agent;

import java.awt.AlphaComposite;
import java.io.ByteArrayOutputStream;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.nio.charset.StandardCharsets;
import java.security.ProtectionDomain;

/** Keeps official Graphwar renderer alpha values inside AlphaComposite's valid range. */
public final class GraphwarAlphaCompositeFixer implements ClassFileTransformer {
    private static final String ALPHA_COMPOSITE = "java/awt/AlphaComposite";
    private static final String GET_INSTANCE_METHOD = "getInstance";
    private static final String GET_INSTANCE_DESCRIPTOR = "(IF)Ljava/awt/AlphaComposite;";
    private static final String GRAPH_PLANE = "Graphwar/GraphPlane";
    private static final String HANDLER_CLASS =
            "top/howiehz/graphwar/agent/GraphwarAlphaCompositeFixer";
    private static final String HANDLER_METHOD = "getClampedInstance";
    private static final String HANDLER_DESCRIPTOR = GET_INSTANCE_DESCRIPTOR;
    private static final int INVOKESTATIC = 0xb8;

    @Override
    public byte[] transform(
            ClassLoader loader,
            String className,
            Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain,
            byte[] classfileBuffer)
            throws IllegalClassFormatException {
        if (!GRAPH_PLANE.equals(className)) {
            return null;
        }

        try {
            byte[] patched = fix(classfileBuffer);
            return patched == classfileBuffer ? null : patched;
        } catch (RuntimeException error) {
            System.err.println(
                    "[graphwar-agent] failed to clamp Graphwar renderer alpha: "
                            + error.getMessage());
            return null;
        }
    }

    /** Redirects GraphPlane's float-alpha factory calls to the range-checking handler. */
    static byte[] fix(byte[] classfileBuffer) {
        ClassFile classFile = new ClassFile(classfileBuffer);
        if (!classFile.hasAlphaCompositeFactoryMethodRef()) {
            return classfileBuffer;
        }

        PatchedConstantPool constantPool = classFile.appendHandlerMethodRef();
        if (new ClassFile(constantPool.bytes)
                        .patchAlphaCompositeFactoryCalls(constantPool.handlerMethodRefIndex)
                == 0) {
            return classfileBuffer;
        }
        return constantPool.bytes;
    }

    /** Applies the AWT precondition at the final boundary without changing valid opacity. */
    public static AlphaComposite getClampedInstance(int rule, float alpha) {
        // Graphwar derives alpha from wall-clock elapsed time. A clock rollback can make
        // elapsed time negative, while the original renderer only clamps the lower bound.
        if (!(alpha >= 0.0f)) {
            alpha = 0.0f;
        } else if (alpha > 1.0f) {
            alpha = 1.0f;
        }
        return AlphaComposite.getInstance(rule, alpha);
    }

    /** Holds the expanded class bytes and the appended handler method reference. */
    private static final class PatchedConstantPool {
        final byte[] bytes;
        final int handlerMethodRefIndex;

        /** Captures one constant-pool expansion before instructions are rewritten. */
        PatchedConstantPool(byte[] bytes, int handlerMethodRefIndex) {
            this.bytes = bytes;
            this.handlerMethodRefIndex = handlerMethodRefIndex;
        }
    }

    /** Minimal class-file editor for same-length GraphPlane call-site replacement. */
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

        /** Parses only the constant-pool structures needed by this narrow patch. */
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

        /** Checks that the official renderer contains the exact AWT factory reference. */
        boolean hasAlphaCompositeFactoryMethodRef() {
            for (int index = 1; index < methodRefClassIndexes.length; index += 1) {
                if (isAlphaCompositeFactoryMethodRef(index)) {
                    return true;
                }
            }
            return false;
        }

        /** Appends the public handler reference without disturbing existing pool indexes. */
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

        /** Replaces every exact float-alpha factory call in GraphPlane. */
        int patchAlphaCompositeFactoryCalls(int handlerMethodRefIndex) {
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
                offset += 6; // access_flags, name_index, descriptor_index
                int attributesCount = readU2(offset);
                offset += 2;
                for (int attributeIndex = 0;
                        attributeIndex < attributesCount;
                        attributeIndex += 1) {
                    int attributeNameIndex = readU2(offset);
                    int attributeLength = readU4(offset + 2);
                    int infoOffset = offset + 6;
                    if ("Code".equals(utf8Values[attributeNameIndex])) {
                        patchCount += patchCodeAttribute(infoOffset, handlerMethodRefIndex);
                    }
                    offset = infoOffset + attributeLength;
                }
            }
            return patchCount;
        }

        /** Parses the constant pool and records only references used by the patch. */
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

        /** Advances past one field or method and all of its attributes. */
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

        /** Rewrites matching invokestatic operands while preserving instruction size. */
        private int patchCodeAttribute(int infoOffset, int handlerMethodRefIndex) {
            int codeLength = readU4(infoOffset + 4);
            int codeOffset = infoOffset + 8;
            int codeEnd = codeOffset + codeLength;
            int patchCount = 0;

            // Same-length replacement keeps branches, exception tables and frames valid.
            // Walk instruction starts only; raw byte scanning could mutate operands.
            for (int offset = codeOffset;
                    offset < codeEnd;
                    offset =
                            GraphwarBytecodeInstructions.nextOffset(
                                    bytes, codeOffset, codeEnd, offset)) {
                if (readU1(offset) == INVOKESTATIC
                        && offset + 2 < codeEnd
                        && isAlphaCompositeFactoryMethodRef(readU2(offset + 1))) {
                    writeU2(bytes, offset + 1, handlerMethodRefIndex);
                    patchCount += 1;
                }
            }
            return patchCount;
        }

        /** Matches only AlphaComposite.getInstance(int, float). */
        private boolean isAlphaCompositeFactoryMethodRef(int constantPoolIndex) {
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
            return ALPHA_COMPOSITE.equals(className)
                    && GET_INSTANCE_METHOD.equals(methodName)
                    && GET_INSTANCE_DESCRIPTOR.equals(descriptor);
        }

        /** Reads one unsigned class-file byte. */
        private int readU1(int offset) {
            return bytes[offset] & 0xff;
        }

        /** Reads one unsigned class-file short. */
        private int readU2(int offset) {
            return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
        }

        /** Reads one class-file integer. */
        private int readU4(int offset) {
            return (readU2(offset) << 16) | readU2(offset + 2);
        }
    }

    /** Writes one CONSTANT_Class entry. */
    private static void writeClass(ByteArrayOutputStream output, int nameIndex) {
        writeU1(output, 7);
        writeU2(output, nameIndex);
    }

    /** Writes one CONSTANT_Methodref entry. */
    private static void writeMethodRef(
            ByteArrayOutputStream output, int classIndex, int nameAndTypeIndex) {
        writeU1(output, 10);
        writeU2(output, classIndex);
        writeU2(output, nameAndTypeIndex);
    }

    /** Writes one CONSTANT_NameAndType entry. */
    private static void writeNameAndType(
            ByteArrayOutputStream output, int nameIndex, int descriptorIndex) {
        writeU1(output, 12);
        writeU2(output, nameIndex);
        writeU2(output, descriptorIndex);
    }

    /** Writes one modified-UTF-8-compatible ASCII constant used by the patch. */
    private static void writeUtf8(ByteArrayOutputStream output, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 0xffff) {
            throw new IllegalArgumentException("UTF-8 constant is too long");
        }
        writeU1(output, 1);
        writeU2(output, bytes.length);
        output.write(bytes, 0, bytes.length);
    }

    /** Writes one class-file byte. */
    private static void writeU1(ByteArrayOutputStream output, int value) {
        output.write(value & 0xff);
    }

    /** Writes one class-file short to a growing buffer. */
    private static void writeU2(ByteArrayOutputStream output, int value) {
        writeU1(output, value >>> 8);
        writeU1(output, value);
    }

    /** Replaces one class-file short in-place. */
    private static void writeU2(byte[] bytes, int offset, int value) {
        bytes[offset] = (byte) ((value >>> 8) & 0xff);
        bytes[offset + 1] = (byte) (value & 0xff);
    }
}
