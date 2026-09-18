import { ApiProperty } from "@nestjs/swagger";

export class UploadFileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description:
      "Relative path — prefix with the API base URL to get a fetchable link. " +
      "Store this in *_url fields (fileUrl/docUrl/signedDocUrl) as-is.",
  })
  url: string;

  @ApiProperty()
  originalName: string;

  @ApiProperty()
  mimeType: string;
}
