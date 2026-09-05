import { environment } from "./environments/environment";

export class ApiService {
  base = environment.apiUrl;
  track = environment.analyticsId;
}
