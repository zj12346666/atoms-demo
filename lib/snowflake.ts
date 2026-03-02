// 雪花算法 ID 生成器

class Snowflake {
  private workerId: number;
  private datacenterId: number;
  private sequence: number = 0;
  private lastTimestamp: bigint = BigInt(-1);

  // 2024-01-01 00:00:00 UTC
  private readonly twepoch = BigInt(1704067200000);
  
  // 机器ID占用的位数
  private readonly workerIdBits = BigInt(5);
  // 数据中心ID占用的位数
  private readonly datacenterIdBits = BigInt(5);
  // 序列号占用的位数
  private readonly sequenceBits = BigInt(12);
  
  // 最大值
  private readonly maxWorkerId = BigInt(-1) ^ (BigInt(-1) << this.workerIdBits);
  private readonly maxDatacenterId = BigInt(-1) ^ (BigInt(-1) << this.datacenterIdBits);
  
  // 移位
  private readonly workerIdShift = this.sequenceBits;
  private readonly datacenterIdShift = this.sequenceBits + this.workerIdBits;
  private readonly timestampLeftShift = this.sequenceBits + this.workerIdBits + this.datacenterIdBits;
  
  // 序列号掩码
  private readonly sequenceMask = BigInt(-1) ^ (BigInt(-1) << this.sequenceBits);

  constructor(workerId: number = 1, datacenterId: number = 1) {
    if (workerId > Number(this.maxWorkerId) || workerId < 0) {
      throw new Error(`workerId must be between 0 and ${this.maxWorkerId}`);
    }
    if (datacenterId > Number(this.maxDatacenterId) || datacenterId < 0) {
      throw new Error(`datacenterId must be between 0 and ${this.maxDatacenterId}`);
    }
    this.workerId = workerId;
    this.datacenterId = datacenterId;
  }

  nextId(): string {
    let timestamp = BigInt(Date.now());

    if (timestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards. Refusing to generate id');
    }

    if (this.lastTimestamp === timestamp) {
      this.sequence = (this.sequence + 1) & Number(this.sequenceMask);
      if (this.sequence === 0) {
        timestamp = this.tilNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    const id = ((timestamp - this.twepoch) << this.timestampLeftShift) |
               (BigInt(this.datacenterId) << this.datacenterIdShift) |
               (BigInt(this.workerId) << this.workerIdShift) |
               BigInt(this.sequence);

    return id.toString();
  }

  private tilNextMillis(lastTimestamp: bigint): bigint {
    let timestamp = BigInt(Date.now());
    while (timestamp <= lastTimestamp) {
      timestamp = BigInt(Date.now());
    }
    return timestamp;
  }
}

// 单例模式
let snowflakeInstance: Snowflake | null = null;

export function getSnowflakeId(): string {
  if (!snowflakeInstance) {
    // 使用进程ID作为workerId，确保唯一性
    const workerId = process.pid % 32;
    snowflakeInstance = new Snowflake(workerId, 1);
  }
  return snowflakeInstance.nextId();
}
