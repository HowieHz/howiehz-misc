package top.howiehz.graphwar.agent;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.nio.charset.StandardCharsets;
import java.security.ProtectionDomain;

final class GraphwarInterruptedSleepSilencer implements ClassFileTransformer {
    // Source: official Graphwar GameData.Countdowner and GraphServer.StartDelayer both
    // catch InterruptedException from Thread.sleep() and call printStackTrace().
    private static final String CLIENT_COUNTDOWNER = "Graphwar/GameData$Countdowner";
    private static final String SERVER_START_DELAYER = "GraphServer/GraphServer$StartDelayer";
    private static final int INVOKEVIRTUAL = 0xb6;
    private static final int NOP = 0x00;
    private static final int POP = 0x57;

    @Override
    public byte[] transform(
            ClassLoader loader,
            String className,
            Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain,
            byte[] classfileBuffer)
            throws IllegalClassFormatException {
        if (!isTargetClass(className)) {
            return null;
        }

        try {
            byte[] patched = silence(classfileBuffer);
            return patched == classfileBuffer ? null : patched;
        } catch (RuntimeException error) {
            System.err.println(
                    "[graphwar-agent] failed to silence Graphwar countdown interrupt log in "
                            + className
                            + ": "
                            + error.getMessage());
            return null;
        }
    }

    static byte[] silence(byte[] classfileBuffer) {
        ClassFile classFile = new ClassFile(classfileBuffer);
        if (!classFile.hasPrintStackTraceMethodRef()) {
            return classfileBuffer;
        }

        byte[] patched = classfileBuffer.clone();
        int patchCount = new ClassFile(patched).patchPrintStackTraceCalls();
        return patchCount == 0 ? classfileBuffer : patched;
    }

    private static boolean isTargetClass(String className) {
        return CLIENT_COUNTDOWNER.equals(className) || SERVER_START_DELAYER.equals(className);
    }

    private static final class ClassFile {
        private final byte[] bytes;
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

            int constantPoolCount = readU2(8);
            this.classNameIndexes = new int[constantPoolCount];
            this.methodRefClassIndexes = new int[constantPoolCount];
            this.methodRefNameAndTypeIndexes = new int[constantPoolCount];
            this.nameAndTypeDescriptorIndexes = new int[constantPoolCount];
            this.nameAndTypeNameIndexes = new int[constantPoolCount];
            this.utf8Values = new String[constantPoolCount];
            this.afterConstantPoolOffset = readConstantPool(constantPoolCount);
        }

        boolean hasPrintStackTraceMethodRef() {
            for (int index = 1; index < methodRefClassIndexes.length; index += 1) {
                if (isPrintStackTraceMethodRef(index)) {
                    return true;
                }
            }
            return false;
        }

        int patchPrintStackTraceCalls() {
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
                        patchCount += patchCodeAttribute(infoOffset);
                    }
                    offset = infoOffset + attributeLength;
                }
            }
            return patchCount;
        }

        private int readConstantPool(int constantPoolCount) {
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

        private int patchCodeAttribute(int infoOffset) {
            int codeLength = readU4(infoOffset + 4);
            int codeOffset = infoOffset + 8;
            int codeEnd = codeOffset + codeLength;
            int patchCount = 0;

            // The target classes are tiny helpers. Same-length replacement keeps branch
            // offsets, exception tables and StackMap frames valid without a bytecode library.
            for (int offset = codeOffset; offset + 2 < codeEnd; offset += 1) {
                if (readU1(offset) == INVOKEVIRTUAL
                        && isPrintStackTraceMethodRef(readU2(offset + 1))) {
                    bytes[offset] = (byte) POP;
                    bytes[offset + 1] = (byte) NOP;
                    bytes[offset + 2] = (byte) NOP;
                    patchCount += 1;
                }
            }

            return patchCount;
        }

        private boolean isPrintStackTraceMethodRef(int constantPoolIndex) {
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
            return "java/lang/InterruptedException".equals(className)
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
}
