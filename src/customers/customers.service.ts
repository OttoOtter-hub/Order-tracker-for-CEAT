import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Customer } from "./customer.entity";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly repo: Repository<Customer>,
  ) {}

  findAll(): Promise<Customer[]> {
    return this.repo.find();
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.repo.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  /**
   * TODO(multi-client): PI upload (ProformaInvoicesService.uploadPi) uses
   * this to pick "the" customer for a newly-created card, since the pilot
   * has exactly one. Once a second customer is onboarded, that call site
   * needs an explicit customerId chosen by the uploader instead of this.
   */
  async findFirst(): Promise<Customer> {
    const [customer] = await this.repo.find({
      order: { createdAt: "ASC" },
      take: 1,
    });
    if (!customer) {
      throw new NotFoundException(
        "No customer exists yet — create one before uploading a PI",
      );
    }
    return customer;
  }

  create(dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.repo.create(dto);
    return this.repo.save(customer);
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id);
    Object.assign(customer, dto);
    return this.repo.save(customer);
  }
}
