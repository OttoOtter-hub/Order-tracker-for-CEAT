import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { SearchQueryDto } from "./dto/search-query.dto";
import { SearchService } from "./search.service";

/**
 * The header search, for both roles. Not @ScopeByCustomer'd: the answer is
 * a composed view, the service scopes it (client -> own customer).
 */
@ApiBearerAuth()
@ApiTags("search")
@Controller("search")
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(@CurrentUser() user: RequestUser, @Query() query: SearchQueryDto) {
    return this.service.search(user, query.q, query.customerId);
  }
}
